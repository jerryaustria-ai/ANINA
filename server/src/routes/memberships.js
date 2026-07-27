import { Router } from "express";
import { Membership } from "../models/Membership.js";
import { MembershipTier } from "../models/MembershipTier.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import * as xendit from "../services/xendit.js";
import { applyEvent } from "../services/membership.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { User } from "../models/User.js";
import { Booking } from "../models/Booking.js";
import { hasPriorClientActivity } from "../services/firstTimer.js";

const router = Router();
router.use(requireAuth);

const allowDevBilling = () => process.env.XENDIT_SIMULATION === "true" && !xendit.isLive();

function appUrl(req) {
  const configured = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (/^https:\/\//i.test(configured)) return configured;
  const protocol = String(req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${protocol}://${host}`;
}

function oneTimePlanStatus(membership) {
  if (!membership) return "Inactive";
  if (membership.status === "cancelled") return "Cancelled";
  if (membership.status !== "active") return "Inactive";
  if (membership.currentPeriodEnd && new Date(membership.currentPeriodEnd) <= new Date()) return "Expired";
  if (!membership.unlimitedClasses && Number(membership.sessionsRemaining) <= 0) return "Fully Used";
  return "Active";
}

function recurringPlanStatus(membership) {
  if (membership.status === "active") return "Active";
  if (membership.status === "cancelled") return "Cancelled";
  if (membership.status === "inactive") return "Inactive";
  if (membership.currentPeriodEnd && new Date(membership.currentPeriodEnd) <= new Date()) return "Expired";
  return "Inactive";
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
    membershipType: "one_time",
    membershipTypeLabel: "One-Time Plan",
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
    validityPeriod: `${purchase.planSnapshot?.intervalCount || 1} ${String(purchase.planSnapshot?.interval || "MONTH").toLowerCase()}${(purchase.planSnapshot?.intervalCount || 1) === 1 ? "" : "s"}`,
    planStatus: oneTimePlanStatus(membership),
    bookingStatus: booking?.status || "—",
    attendanceStatus: ["attended", "no_show"].includes(booking?.status) ? booking.status : "Not recorded",
  };
}

function recurringMembershipRecord(membership) {
  const tier = membership.tier;
  const cycle = `${tier?.intervalCount || 1} ${String(tier?.interval || "MONTH").toLowerCase()}${(tier?.intervalCount || 1) === 1 ? "" : "s"}`;
  return {
    id: `recurring-${membership._id}`,
    membershipId: membership._id,
    membershipType: "recurring",
    membershipTypeLabel: "Recurring Subscription",
    client: membership.client ? {
      id: membership.client._id,
      name: membership.client.name,
      email: membership.client.email,
      phone: membership.client.phone,
      picture: membership.client.picture,
      active: membership.client.active,
      createdAt: membership.client.createdAt,
    } : null,
    referenceId: membership.referenceId,
    purchasedPlan: tier?.name || "Recurring Membership",
    className: tier?.classTags?.length ? tier.classTags.join(", ") : "All eligible classes",
    amountPaid: tier?.amount || 0,
    currency: tier?.currency || "PHP",
    paymentMethod: "Xendit",
    paymentStatus: membership.status === "active" || membership.cycleCount > 0 ? "Paid"
      : membership.status === "past_due" ? "Failed" : "Pending",
    paymentDate: membership.status === "active" ? membership.updatedAt : null,
    bookingDate: membership.createdAt,
    startDate: membership.createdAt,
    expirationDate: null,
    planStatus: recurringPlanStatus(membership),
    billingCycle: cycle,
    nextBillingDate: membership.status === "active" ? membership.currentPeriodEnd : null,
    renewalStatus: membership.status === "active" ? "Auto-renew enabled"
      : membership.status === "cancelled" ? "Cancelled" : membership.status === "inactive" ? "Stopped" : "Pending activation",
    subscriptionStatus: membership.status,
    cycleCount: membership.cycleCount,
    bookingStatus: "—",
    attendanceStatus: "Not recorded",
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
    const all = await Membership.find({ client: req.user._id }).sort("-createdAt").populate("tier");
    res.json({
      membership: m ? m.toPublic() : null,
      memberships: all.map((membership) => membership.toPublic()),
      live: xendit.isLive(),
    });
  })
);

// POST /api/memberships/subscribe { tierId } — start a subscription.
router.post(
  "/subscribe",
  requireRole("client", "admin"),
  asyncHandler(async (req, res) => {
    const tier = await MembershipTier.findById(req.body?.tierId);
    if (!tier || !tier.active) throw new HttpError(400, "Tier not found or inactive");
    if (tier.firstTimerOnly && await hasPriorClientActivity(req.user.email)) {
      throw new HttpError(409, "This plan is available for first-time clients only.");
    }
    const existing = await Membership.findOne({
      client: req.user._id,
      source: "membership",
      status: { $in: ["active", "pending", "past_due"] },
    });
    if (existing?.status === "active") throw new HttpError(409, "You already have an active recurring subscription");

    const referenceId = `mem_${req.user._id}_${Date.now()}`;
    const customer = await xendit.createCustomer(req.user);
    const publicUrl = appUrl(req);
    const subscription = await xendit.createSubscription({
      referenceId,
      customerId: customer.id,
      tier,
      successUrl: `${publicUrl}/dashboard/membership?status=success`,
      cancelUrl: `${publicUrl}/dashboard/membership?status=cancelled`,
    });
    const membership = await Membership.create({
      client: req.user._id,
      tier: tier._id,
      status: "pending",
      source: "membership",
      referenceId,
      xenditCustomerId: customer.id,
      xenditPlanId: subscription.planId,
      checkoutUrl: subscription.checkoutUrl,
      simulated: !xendit.isLive(),
    });
    await membership.populate("tier");
    res.status(201).json({
      membership: membership.toPublic(),
      checkoutUrl: subscription.checkoutUrl,
      simulated: !xendit.isLive(),
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
    const cancelled = await xendit.cancelSubscription(m.xenditPlanId, m.referenceId);
    if (cancelled.planId) m.xenditPlanId = cancelled.planId;
    await applyEvent(m, "cancelled");
    res.json({ membership: m.toPublic() });
  })
);

// Admin: combined one-time plan and recurring subscription ledger.
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const [purchases, recurringMemberships] = await Promise.all([
      GuestPurchase.find({
        paidAt: { $ne: null },
        client: { $ne: null },
        membership: { $ne: null },
      }).sort("-paidAt -createdAt").populate(purchasePopulate),
      Membership.find({ source: "membership" }).populate("tier")
        .populate("client", "name email phone picture active createdAt").sort("-createdAt"),
    ]);
    const memberships = [
      ...purchases.map(oneTimePurchaseRecord),
      ...recurringMemberships.map(recurringMembershipRecord),
    ].sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    res.json({ memberships });
  })
);

// Admin: complete one-time, recurring, and class history for one client.
router.get(
  "/clients/:clientId/record",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const client = await User.findOne({ _id: req.params.clientId, role: "client" })
      .select("name email phone picture active createdAt");
    if (!client) throw new HttpError(404, "Client record not found");
    const [purchases, recurringMemberships, bookings] = await Promise.all([
      GuestPurchase.find({
        client: client._id,
        paidAt: { $ne: null },
        membership: { $ne: null },
      }).sort("-paidAt -createdAt").populate(purchasePopulate),
      Membership.find({ client: client._id, source: "membership" }).populate("tier")
        .populate("client", "name email phone picture active createdAt").sort("-createdAt"),
      Booking.find({ client: client._id }).populate({
        path: "session",
        populate: { path: "instructor", select: "name email" },
      }).populate("purchase").sort("-createdAt"),
    ]);
    const oneTimeRecords = purchases.map(oneTimePurchaseRecord);
    const recurringRecords = recurringMemberships.map(recurringMembershipRecord);
    const latestRecurring = recurringRecords[0] || null;
    const recurringBookingHistory = bookings
      .filter((booking) => !booking.purchase)
      .map((booking) => ({
        id: `booking-${booking._id}`,
        membershipId: latestRecurring?.membershipId || null,
        membershipType: "recurring",
        membershipTypeLabel: "Recurring Subscription",
        referenceId: latestRecurring?.referenceId || `booking-${booking._id}`,
        purchasedPlan: latestRecurring?.purchasedPlan || "Recurring Membership",
        className: booking.session?.title || "—",
        session: booking.session ? {
          id: booking.session._id,
          title: booking.session.title,
          startAt: booking.session.startAt,
          endAt: booking.session.endAt,
          instructor: booking.session.instructor ? {
            id: booking.session.instructor._id,
            name: booking.session.instructor.name,
          } : null,
        } : null,
        amountPaid: latestRecurring?.amountPaid || 0,
        currency: latestRecurring?.currency || "PHP",
        paymentMethod: latestRecurring?.paymentMethod || "Xendit",
        paymentStatus: booking.paymentStatus === "paid" ? "Paid" : latestRecurring?.paymentStatus || "Pending",
        paymentDate: latestRecurring?.paymentDate || null,
        bookingDate: booking.createdAt,
        expirationDate: null,
        planStatus: latestRecurring?.planStatus || "Inactive",
        bookingStatus: booking.status,
        attendanceStatus: ["attended", "no_show"].includes(booking.status) ? booking.status : "Not recorded",
      }));
    const membershipRecords = [...oneTimeRecords, ...recurringRecords]
      .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    const history = [...oneTimeRecords, ...recurringRecords, ...recurringBookingHistory]
      .sort((a, b) => new Date(b.bookingDate) - new Date(a.bookingDate));
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
      activeMemberships: membershipRecords.filter((record) => record.planStatus === "Active"),
      history,
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
