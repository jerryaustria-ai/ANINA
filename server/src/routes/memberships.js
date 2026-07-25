import { Router } from "express";
import { Membership } from "../models/Membership.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import * as xendit from "../services/xendit.js";
import { applyEvent } from "../services/membership.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { User } from "../models/User.js";

const router = Router();
router.use(requireAuth);

const allowDevBilling = () => process.env.XENDIT_SIMULATION === "true" && !xendit.isLive();

function oneTimePlanStatus(membership) {
  if (!membership) return "Inactive";
  if (membership.status === "cancelled") return "Cancelled";
  if (membership.status !== "active") return "Inactive";
  if (membership.currentPeriodEnd && new Date(membership.currentPeriodEnd) <= new Date()) return "Expired";
  if (!membership.unlimitedClasses && Number(membership.sessionsRemaining) <= 0) return "Fully Used";
  return "Active";
}

function oneTimePurchaseRecord(purchase) {
  const membership = purchase.membership;
  const booking = purchase.booking;
  const session = purchase.session;
  const included = membership?.sessionsIncluded ??
    (purchase.planSnapshot?.unlimitedClasses ? null : (purchase.planSnapshot?.sessionCount || 1));
  const remaining = membership?.sessionsRemaining ?? included;
  return {
    id: purchase._id,
    membershipId: membership?._id || null,
    client: purchase.client ? {
      id: purchase.client._id,
      name: purchase.client.name,
      email: purchase.client.email,
      phone: purchase.client.phone,
      picture: purchase.client.picture,
      active: purchase.client.active,
      createdAt: purchase.client.createdAt,
    } : null,
    referenceId: purchase.referenceId,
    purchasedPlan: purchase.planSnapshot?.name || purchase.tier?.name || "Class Plan",
    className: session?.title || "—",
    session: session ? {
      id: session._id,
      title: session.title,
      startAt: session.startAt,
      endAt: session.endAt,
      instructor: session.instructor ? {
        id: session.instructor._id,
        name: session.instructor.name,
      } : null,
    } : null,
    amountPaid: purchase.totalAmount,
    currency: purchase.currency,
    paymentMethod: purchase.paymentMethod || "Xendit",
    paymentStatus: purchase.refundedAt ? "Refunded" : purchase.paidAt ? "Paid" : "Pending",
    paymentDate: purchase.paidAt,
    bookingDate: purchase.createdAt,
    includedSessions: included,
    usedSessions: included == null || remaining == null ? null : Math.max(0, included - remaining),
    remainingSessions: remaining,
    unlimitedClasses: !!membership?.unlimitedClasses,
    startDate: purchase.paidAt || membership?.createdAt || purchase.createdAt,
    expirationDate: membership?.currentPeriodEnd || null,
    planStatus: oneTimePlanStatus(membership),
    bookingStatus: booking?.status || "—",
    attendanceStatus: ["attended", "no_show"].includes(booking?.status) ? booking.status : "Not recorded",
  };
}

const purchasePopulate = [
  { path: "client", select: "name email phone picture active createdAt" },
  { path: "tier" },
  { path: "membership" },
  { path: "booking" },
  { path: "session", populate: { path: "instructor", select: "name email" } },
];

// GET /api/memberships/mine — the signed-in client's current membership.
router.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const m = await Membership.findOne({ client: req.user._id }).sort("-createdAt").populate("tier");
    if (m && xendit.isLive() && ["pending", "past_due"].includes(m.status)) {
      try {
        const remote = await xendit.getSubscriptionStatus(m.xenditPlanId, m.referenceId);
        if (remote.planId?.startsWith("repl_")) m.xenditPlanId = remote.planId;
        if (remote.status === "active") await applyEvent(m, "activated");
        else if (remote.status === "inactive") await applyEvent(m, "inactivated");
        else if (m.isModified()) await m.save();
      } catch (error) {
        // Keep the membership page available during a temporary Xendit outage;
        // webhooks or a later refresh will retry reconciliation.
        console.warn("Xendit membership reconciliation failed:", error.message);
      }
    }
    res.json({ membership: m ? m.toPublic() : null, live: xendit.isLive() });
  })
);

// POST /api/memberships/subscribe { tierId } — start a subscription.
router.post(
  "/subscribe",
  requireRole("client", "admin"),
  asyncHandler(async (req, res) => {
    throw new HttpError(
      410,
      "Recurring subscriptions are no longer available. Select a published class and purchase a class plan with a one-time payment."
    );
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
    const cancelled = await xendit.cancelSubscription(m.xenditPlanId, m.referenceId);
    if (cancelled.planId) m.xenditPlanId = cancelled.planId;
    await applyEvent(m, "cancelled");
    res.json({ membership: m.toPublic() });
  })
);

// Admin: list successful one-time class-plan purchases.
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const purchases = await GuestPurchase.find({
      paidAt: { $ne: null },
      client: { $ne: null },
      membership: { $ne: null },
    }).sort("-paidAt -createdAt").populate(purchasePopulate);
    res.json({ purchases: purchases.map(oneTimePurchaseRecord) });
  })
);

// Admin: complete one-time plan and class history for one client.
router.get(
  "/clients/:clientId/record",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const client = await User.findOne({ _id: req.params.clientId, role: "client" })
      .select("name email phone picture active createdAt");
    if (!client) throw new HttpError(404, "Client record not found");
    const purchases = await GuestPurchase.find({
      client: client._id,
      paidAt: { $ne: null },
      membership: { $ne: null },
    }).sort("-paidAt -createdAt").populate(purchasePopulate);
    const records = purchases.map(oneTimePurchaseRecord);
    res.json({
      client: {
        id: client._id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        picture: client.picture,
        active: client.active,
        createdAt: client.createdAt,
      },
      activePlans: records.filter((record) => record.planStatus === "Active"),
      history: records,
    });
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
