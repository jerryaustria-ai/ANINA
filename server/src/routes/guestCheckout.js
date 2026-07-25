import crypto from "node:crypto";
import { Router } from "express";
import { ClassSession } from "../models/ClassSession.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { MembershipTier } from "../models/MembershipTier.js";
import { fulfillGuestPurchase } from "../services/guestPurchase.js";
import * as xendit from "../services/xendit.js";
import { asyncHandler } from "../utils/http.js";
import { sendPurchaseStatusEmailOnce } from "../services/email.js";

const router = Router();
const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const safeSession = (session) => session?.status === "published" &&
  session?.isPublished === true && session?.approvedAt && new Date(session.endAt) > new Date();

function matchesClass(tier, session) {
  if (!tier.classTags?.length) return true;
  const title = normalize(session.title);
  return tier.classTags.some((tag) => {
    const normalized = normalize(tag);
    return normalized && (title.includes(normalized) || normalized.includes(title));
  });
}

function planSnapshot(tier) {
  return {
    id: tier._id,
    name: tier.name,
    description: tier.description,
    amount: tier.amount,
    currency: tier.currency,
    sessionCount: tier.sessionCount,
    unlimitedClasses: tier.unlimitedClasses,
    interval: tier.interval,
    intervalCount: tier.intervalCount,
    classTags: tier.classTags,
  };
}

async function loadAuthorizedOrder(req) {
  const purchase = await GuestPurchase.findById(req.params.id).populate({
    path: "session",
    populate: [{ path: "instructor" }, { path: "room" }],
  }).populate("tier");
  const token = req.get("x-guest-token") || req.query.token || req.body?.token;
  if (!purchase || !token || token !== purchase.accessToken) {
    throw Object.assign(new Error("Order not found."), { status: 404 });
  }
  return purchase;
}

router.get("/plans", asyncHandler(async (req, res) => {
  const session = await ClassSession.findById(req.query.sessionId).populate("instructor room");
  if (!safeSession(session)) return res.status(409).json({ error: "This class is no longer available for booking." });
  const tiers = await MembershipTier.find({ active: true }).sort({ sortOrder: 1, amount: 1 });
  res.json({
    session: session.toPublic(),
    plans: tiers.filter((tier) => matchesClass(tier, session)).map((tier) => tier.toPublic()),
    vatRate: Number(process.env.VAT_RATE || 0),
  });
}));

router.post("/orders", asyncHandler(async (req, res) => {
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const phone = String(req.body.phone || "").trim();
  if (fullName.length < 2) return res.status(400).json({ error: "Please enter your full name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email address." });
  if (phone.length < 7) return res.status(400).json({ error: "Please enter a valid phone number." });

  const [session, tier] = await Promise.all([
    ClassSession.findById(req.body.sessionId).populate("instructor room"),
    MembershipTier.findOne({ _id: req.body.tierId, active: true }),
  ]);
  if (!safeSession(session)) return res.status(409).json({ error: "This class is no longer available for booking." });
  if (!tier || !matchesClass(tier, session)) return res.status(400).json({ error: "The selected plan is not available for this class." });

  const vatRate = Math.max(0, Number(process.env.VAT_RATE || 0));
  const totalAmount = tier.amount;
  const subtotal = vatRate ? Math.round((totalAmount / (1 + vatRate)) * 100) / 100 : totalAmount;
  const vatAmount = Math.round((totalAmount - subtotal) * 100) / 100;
  const purchase = await GuestPurchase.create({
    fullName, email, phone, session: session._id, tier: tier._id,
    planSnapshot: planSnapshot(tier),
    subtotal, vatAmount, totalAmount, currency: tier.currency,
    referenceId: `guest_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`,
    accessToken: crypto.randomBytes(24).toString("hex"),
  });
  await purchase.populate([{ path: "session", populate: [{ path: "instructor" }, { path: "room" }] }, { path: "tier" }]);
  res.status(201).json({ order: purchase.toPublic(), token: purchase.accessToken });
}));

router.get("/orders/:id", asyncHandler(async (req, res) => {
  const purchase = await loadAuthorizedOrder(req);
  res.json({ order: purchase.toPublic() });
}));

router.post("/orders/:id/payment-session", asyncHandler(async (req, res) => {
  const purchase = await loadAuthorizedOrder(req);
  if (["confirmed", "waitlisted"].includes(purchase.status)) return res.json({ order: purchase.toPublic() });
  if (!safeSession(purchase.session)) return res.status(409).json({ error: "This class is no longer available for booking." });

  if (!purchase.xenditSessionId) {
    const configured = String(process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
    const protocol = String(req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
    const host = req.get("x-forwarded-host") || req.get("host");
    const appUrl = (/^https:\/\//i.test(configured) ? configured : `${protocol}://${host}`).replace(/\/$/, "");
    if (xendit.isLive() && !appUrl.startsWith("https://")) {
      return res.status(500).json({ error: "PUBLIC_APP_URL must be a valid HTTPS URL for live Xendit checkout." });
    }
    const payment = await xendit.createOneTimePaymentSession({
      referenceId: purchase.referenceId,
      customer: purchase,
      plan: purchase.planSnapshot,
      successUrl: `${appUrl}/guest/checkout/${purchase._id}?token=${purchase.accessToken}&payment=success`,
      cancelUrl: `${appUrl}/guest/checkout/${purchase._id}?token=${purchase.accessToken}&payment=cancelled`,
    });
    purchase.xenditSessionId = payment.sessionId;
    purchase.checkoutUrl = payment.checkoutUrl;
    purchase.simulated = !!payment.simulated;
    purchase.status = "payment_pending";
    await purchase.save();
    await sendPurchaseStatusEmailOnce(
      purchase._id,
      "payment_pending",
      `payment-pending:${purchase.xenditSessionId}`
    ).catch((error) => console.warn("Pending payment email failed:", error.message));
  }
  res.json({ order: purchase.toPublic(), checkoutUrl: purchase.checkoutUrl, simulated: purchase.simulated });
}));

router.post("/orders/:id/simulate-success", asyncHandler(async (req, res) => {
  const purchase = await loadAuthorizedOrder(req);
  if (xendit.isLive() || process.env.XENDIT_SIMULATION !== "true") {
    return res.status(404).json({ error: "Not found" });
  }
  purchase.simulated = true;
  await purchase.save();
  const fulfilled = await fulfillGuestPurchase(purchase._id, { paymentId: `sim_payment_${purchase._id}` });
  res.json({ order: fulfilled.toPublic() });
}));

export default router;
