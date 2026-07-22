import { Router } from "express";
import { Membership } from "../models/Membership.js";
import { MembershipTier } from "../models/MembershipTier.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import * as xendit from "../services/xendit.js";
import { applyEvent } from "../services/membership.js";

const router = Router();
router.use(requireAuth);

const allowDevBilling = () => process.env.XENDIT_SIMULATION === "true" && !xendit.isLive();

function appUrl(req) {
  const configured = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
  // Xendit requires HTTPS return URLs. Ignore a stale localhost/http value on
  // Render and derive the public origin from its forwarded request headers.
  if (/^https:\/\//i.test(configured)) return configured;
  const protocol = String(req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${protocol}://${host}`;
}

// GET /api/memberships/mine — the signed-in client's current membership.
router.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const m = await Membership.findOne({ client: req.user._id }).sort("-createdAt").populate("tier");
    res.json({ membership: m ? m.toPublic() : null, live: xendit.isLive() });
  })
);

// POST /api/memberships/subscribe { tierId } — start a subscription.
router.post(
  "/subscribe",
  requireRole("client", "admin"),
  asyncHandler(async (req, res) => {
    const tier = await MembershipTier.findById(req.body?.tierId);
    if (!tier || !tier.active) throw new HttpError(400, "Tier not found or inactive");

    // Block a duplicate active/pending membership.
    const existing = await Membership.findOne({ client: req.user._id, status: { $in: ["active", "pending", "past_due"] } });
    if (existing && existing.status === "active") throw new HttpError(409, "You already have an active membership");

    const referenceId = `mem_${req.user._id}_${Date.now()}`;
    const customer = await xendit.createCustomer(req.user);
    const publicUrl = appUrl(req);
    const sub = await xendit.createSubscription({
      referenceId,
      customerId: customer.id,
      tier,
      successUrl: `${publicUrl}/membership?status=success`,
      cancelUrl: `${publicUrl}/membership?status=cancelled`,
    });

    const membership = await Membership.create({
      client: req.user._id,
      tier: tier._id,
      status: "pending",
      referenceId,
      xenditCustomerId: customer.id,
      xenditPlanId: sub.planId,
      checkoutUrl: sub.checkoutUrl,
      simulated: !xendit.isLive(),
    });
    await membership.populate("tier");

    res.status(201).json({
      membership: membership.toPublic(),
      checkoutUrl: sub.checkoutUrl,   // live: redirect the client here
      simulated: !xendit.isLive(),    // dev: client completes via /simulate
    });
  })
);

// POST /api/memberships/:id/cancel — client cancels own, or admin cancels any.
router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const m = await Membership.findById(req.params.id).populate("tier");
    if (!m) throw new HttpError(404, "Membership not found");
    if (req.user.role !== "admin" && m.client.toString() !== req.user._id.toString()) {
      throw new HttpError(403, "Not your membership");
    }
    await xendit.cancelSubscription(m.xenditPlanId);
    await applyEvent(m, "cancelled");
    res.json({ membership: m.toPublic() });
  })
);

// Admin: list all memberships.
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const list = await Membership.find(filter).sort("-createdAt").populate("tier").populate("client", "name email picture");
    res.json({ memberships: list.map((m) => m.toPublic()) });
  })
);

// DEV ONLY — simulate the Xendit webhook lifecycle without real payments.
// event: activated | cycle_succeeded | cycle_failed | inactivated | cancelled
router.post(
  "/:id/simulate",
  asyncHandler(async (req, res) => {
    if (!allowDevBilling()) throw new HttpError(404, "Not found");
    const m = await Membership.findById(req.params.id).populate("tier");
    if (!m) throw new HttpError(404, "Membership not found");
    if (req.user.role !== "admin" && m.client.toString() !== req.user._id.toString()) {
      throw new HttpError(403, "Not your membership");
    }
    await applyEvent(m, req.body?.event || "activated");
    res.json({ membership: m.toPublic() });
  })
);

export default router;
