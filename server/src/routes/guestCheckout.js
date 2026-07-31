import crypto from "node:crypto";
import { Router } from "express";
import { ClassSession } from "../models/ClassSession.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { MembershipTier } from "../models/MembershipTier.js";
import {
  confirmCashEnrollment,
  cancelCashPurchase,
  fulfillGuestPurchase,
  markCashPurchasePaid,
} from "../services/guestPurchase.js";
import * as xendit from "../services/xendit.js";
import { asyncHandler } from "../utils/http.js";
import { sendPurchaseStatusEmailOnce } from "../services/email.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { findActiveDuplicate, findActiveScheduleConflict } from "../services/duplicatePurchase.js";
import { hasPriorClientActivity } from "../services/firstTimer.js";
import { VAT_RATE, vatInclusiveBreakdown } from "../utils/vat.js";
import { createAuditLog } from "../services/audit.js";
import {
  applyPromoToPurchase,
  removePromoFromPurchase,
  revalidateAppliedPromo,
} from "../services/promoCodes.js";
import { isAdminRole } from "../utils/roles.js";

const router = Router();
const safeSession = (session) => session?.status === "published" &&
  session?.isPublished === true && session?.approvedAt && new Date(session.endAt) > new Date();

function matchesClass(tier, session) {
  const classId = String(session.classDefinition?._id || session.classDefinition || "");
  return !!classId && (tier.eligibleClassIds || []).some((id) => String(id?._id || id) === classId);
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
    firstTimerOnly: tier.firstTimerOnly,
    interval: tier.interval,
    intervalCount: tier.intervalCount,
    classTags: tier.classTags,
    eligibleClassIds: tier.eligibleClassIds,
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
  const session = await ClassSession.findById(req.query.sessionId).populate("instructor room classDefinition");
  if (!safeSession(session)) return res.status(409).json({ error: "This class is no longer available for booking." });
  const tiers = await MembershipTier.find({ active: true }).sort({ sortOrder: 1, amount: 1 });
  const eligibleTiers = tiers.filter((tier) => matchesClass(tier, session));
  const legacyCashTier = eligibleTiers.find((tier) => /\bcash\b/i.test(tier.name));
  const plans = eligibleTiers.filter((tier) => tier !== legacyCashTier).map((tier) => tier.toPublic());
  const cashPrice = Number(session.classDefinition?.cashPrice || legacyCashTier?.amount || 0);
  if (cashPrice > 0) plans.push({
    id: "cash",
    name: "Regular Class — Cash Payment",
    description: "Book this class without an active plan. Pay at ANINA before attending.",
    amount: cashPrice,
    currency: "PHP",
    interval: "DAY",
    intervalCount: 1,
    sessionCount: 1,
    unlimitedClasses: false,
    firstTimerOnly: false,
    directCash: true,
  });
  res.json({
    session: session.toPublic(),
    plans,
    vatRate: VAT_RATE,
  });
}));

router.post("/orders", optionalAuth, asyncHandler(async (req, res) => {
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const phone = String(req.body.phone || "").trim();
  if (fullName.length < 2) return res.status(400).json({ error: "Please enter your full name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email address." });
  if (phone.length < 7) return res.status(400).json({ error: "Please enter a valid phone number." });

  const directCash = req.body.tierId === "cash";
  const [session, tier] = await Promise.all([
    ClassSession.findById(req.body.sessionId).populate("instructor room classDefinition"),
    directCash ? null : MembershipTier.findOne({ _id: req.body.tierId, active: true }),
  ]);
  if (!safeSession(session)) return res.status(409).json({ error: "This class is no longer available for booking." });
  const legacyCashTier = directCash && !Number(session.classDefinition?.cashPrice)
    ? await MembershipTier.findOne({
        active: true,
        eligibleClassIds: session.classDefinition._id,
        name: { $regex: "\\bcash\\b", $options: "i" },
      }).sort("amount")
    : null;
  const cashPrice = Number(session.classDefinition?.cashPrice || legacyCashTier?.amount || 0);
  if (directCash && cashPrice <= 0) {
    return res.status(400).json({ error: "Cash Payment is not configured for this class." });
  }
  if (!directCash && (!tier || !matchesClass(tier, session))) {
    return res.status(400).json({ error: "The selected plan is not available for this class." });
  }
  const selectedPlan = directCash ? {
    _id: null,
    name: "Regular Class — Cash Payment",
    description: "Direct cash booking",
    amount: cashPrice,
    currency: "PHP",
    interval: "DAY",
    intervalCount: 1,
    sessionCount: 1,
    unlimitedClasses: false,
    firstTimerOnly: false,
    eligibleClassIds: [session.classDefinition._id],
    classTags: [],
  } : tier;
  if (selectedPlan.firstTimerOnly && await hasPriorClientActivity(email)) {
    return res.status(409).json({
      error: "This plan is available for first-time clients only.",
      code: "FIRST_TIMER_ONLY",
    });
  }

  const scheduleConflict = await findActiveScheduleConflict({ email, session, tier: selectedPlan });
  if (scheduleConflict) {
    return res.status(409).json({
      error: "You already have an active class with the same validity period, date, and time.",
      code: "ACTIVE_SCHEDULE_CONFLICT",
      details: scheduleConflict,
    });
  }

  const duplicate = await findActiveDuplicate({ email, session, tier: selectedPlan });
  const adminOverrideEnabled = process.env.ALLOW_ADMIN_DUPLICATE_PURCHASE === "true";
  const mayOverride = adminOverrideEnabled && isAdminRole(req.user?.role);
  const overrideRequested = mayOverride && req.body.continueAnyway === true;
  if (duplicate && !overrideRequested) {
    return res.status(409).json({
      error: "You already have an active booking or class plan matching this selection. Please review your existing booking before purchasing another one.",
      code: "DUPLICATE_ACTIVE_PURCHASE",
      details: { ...duplicate, allowAdminOverride: mayOverride },
    });
  }

  const { subtotal, vatAmount, totalAmount } = vatInclusiveBreakdown(selectedPlan.amount);
  const purchase = await GuestPurchase.create({
    fullName, email, phone, session: session._id, tier: tier?._id || null,
    planSnapshot: directCash ? { ...selectedPlan, id: "cash", _id: undefined, directCash: true }
      : planSnapshot(tier),
    subtotal, vatAmount, totalAmount, originalAmount: totalAmount, currency: selectedPlan.currency,
    referenceId: `guest_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`,
    accessToken: crypto.randomBytes(24).toString("hex"),
    duplicateOverrideBy: overrideRequested ? req.user._id : null,
    duplicateOverrideAt: overrideRequested ? new Date() : null,
  });
  await purchase.populate([{ path: "session", populate: [{ path: "instructor" }, { path: "room" }] }, { path: "tier" }]);
  res.status(201).json({ order: purchase.toPublic(), token: purchase.accessToken });
}));

// Authenticated customers can view every successful guest checkout associated
// with their single email-based user account.
router.get("/history/mine", requireAuth, asyncHandler(async (req, res) => {
  const purchases = await GuestPurchase.find({
    client: req.user._id,
    $or: [{ paidAt: { $ne: null } }, { status: "pending_cash_payment" }],
  }).populate({
    path: "session",
    populate: [{ path: "instructor" }, { path: "room" }],
  }).populate("tier").sort("-paidAt -createdAt");
  res.json({ purchases: purchases.map((purchase) => purchase.toPublic()) });
}));

router.get("/orders/:id", asyncHandler(async (req, res) => {
  let purchase = await loadAuthorizedOrder(req);
  if (purchase.status === "payment_pending" && purchase.xenditSessionId) {
    try {
      const remote = await xendit.getOneTimePaymentSession(purchase.xenditSessionId);
      const referenceMatches = remote.simulated || remote.referenceId === purchase.referenceId;
      const amountMatches = remote.amount == null || Number(remote.amount) === Number(purchase.totalAmount);
      const currencyMatches = !remote.currency || remote.currency === purchase.currency;
      if (remote.status === "COMPLETED" && referenceMatches && amountMatches && currencyMatches) {
        purchase.paymentRequestId = remote.paymentRequestId || purchase.paymentRequestId;
        purchase.paymentMethod ||= "Xendit";
        await purchase.save();
        purchase = await fulfillGuestPurchase(purchase._id, { paymentId: remote.paymentId });
      }
    } catch (error) {
      // Keep the order pending and allow the normal webhook/poll retry path.
      console.warn("Payment-session reconciliation failed:", error.message);
    }
  }
  res.json({ order: purchase.toPublic() });
}));

router.post("/orders/:id/promo-code", asyncHandler(async (req, res) => {
  const purchase = await loadAuthorizedOrder(req);
  if (!["pending_payment", "payment_pending"].includes(purchase.status) || purchase.paidAt) {
    return res.status(409).json({ error: "Promo codes can only be applied before payment is completed." });
  }
  if (purchase.xenditSessionId) {
    return res.status(409).json({ error: "The payment session has already been created. Start a new checkout to change the promo code." });
  }
  await applyPromoToPurchase(purchase, req.body.code);
  res.json({ order: purchase.toPublic(), message: "Promo code applied successfully." });
}));

router.delete("/orders/:id/promo-code", asyncHandler(async (req, res) => {
  const purchase = await loadAuthorizedOrder(req);
  if (!["pending_payment", "payment_pending"].includes(purchase.status) || purchase.paidAt) {
    return res.status(409).json({ error: "The promo code can no longer be removed." });
  }
  if (purchase.xenditSessionId) {
    return res.status(409).json({ error: "The payment session has already been created. Start a new checkout to change the promo code." });
  }
  await removePromoFromPurchase(purchase);
  res.json({ order: purchase.toPublic(), message: "Promo code removed." });
}));

router.post("/orders/:id/payment-session", asyncHandler(async (req, res) => {
  const purchase = await loadAuthorizedOrder(req);
  if (purchase.planSnapshot?.directCash === true) {
    return res.status(409).json({
      error: "This booking is configured for Cash Payment and cannot use Online Payment.",
      code: "PAYMENT_METHOD_LOCKED",
    });
  }
  if (["confirmed", "waitlisted"].includes(purchase.status)) return res.json({ order: purchase.toPublic() });
  if (!safeSession(purchase.session)) return res.status(409).json({ error: "This class is no longer available for booking." });
  if (purchase.tier?.firstTimerOnly && await hasPriorClientActivity(purchase.email, {
    excludePurchaseId: purchase._id,
  })) {
    return res.status(409).json({
      error: "This plan is available for first-time clients only.",
      code: "FIRST_TIMER_ONLY",
    });
  }
  const scheduleConflict = await findActiveScheduleConflict({
    email: purchase.email,
    session: purchase.session,
    tier: purchase.tier,
    excludePurchaseId: purchase._id,
  });
  if (scheduleConflict) {
    return res.status(409).json({
      error: "You already have an active class with the same validity period, date, and time.",
      code: "ACTIVE_SCHEDULE_CONFLICT",
      details: scheduleConflict,
    });
  }
  if (!purchase.duplicateOverrideBy) {
    const duplicate = await findActiveDuplicate({
      email: purchase.email,
      session: purchase.session,
      tier: purchase.tier,
    });
    if (duplicate) {
      return res.status(409).json({
        error: "You already have an active booking or class plan matching this selection. Please review your existing booking before purchasing another one.",
        code: "DUPLICATE_ACTIVE_PURCHASE",
        details: duplicate,
      });
    }
  }
  await revalidateAppliedPromo(purchase);

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
      plan: { ...purchase.planSnapshot, amount: purchase.totalAmount },
      successUrl: `${appUrl}/guest/payment-result/${purchase._id}?token=${purchase.accessToken}&return=success`,
      cancelUrl: `${appUrl}/guest/payment-result/${purchase._id}?token=${purchase.accessToken}&return=cancelled`,
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

router.post("/orders/:id/cash-confirmation", asyncHandler(async (req, res) => {
  const purchase = await loadAuthorizedOrder(req);
  if (purchase.planSnapshot?.directCash !== true) {
    return res.status(409).json({
      error: "This Plan/Package is configured for Online Payment through Xendit.",
      code: "PAYMENT_METHOD_LOCKED",
    });
  }
  if (purchase.status === "pending_cash_payment") return res.json({ order: purchase.toPublic() });
  const directCash = purchase.planSnapshot?.directCash === true;
  const selectedPlan = directCash ? purchase.planSnapshot : purchase.tier;
  const directCashAvailable = directCash && Number(purchase.session?.classDefinition?.cashPrice || purchase.totalAmount) > 0;
  if (!safeSession(purchase.session) ||
      (!directCashAvailable && (!purchase.tier?.active || !matchesClass(purchase.tier, purchase.session)))) {
    return res.status(409).json({ error: "This Plan/Package is no longer available for the selected class." });
  }
  if (selectedPlan.firstTimerOnly && await hasPriorClientActivity(purchase.email, {
    excludePurchaseId: purchase._id,
  })) {
    return res.status(409).json({ error: "This plan is available for first-time clients only.", code: "FIRST_TIMER_ONLY" });
  }
  const conflict = await findActiveScheduleConflict({
    email: purchase.email, session: purchase.session, tier: selectedPlan,
    excludePurchaseId: purchase._id,
  });
  if (conflict) return res.status(409).json({
    error: "You already have an active class with the same validity period, date, and time.",
    code: "ACTIVE_SCHEDULE_CONFLICT",
  });
  if (!purchase.duplicateOverrideBy && await findActiveDuplicate({
    email: purchase.email, session: purchase.session, tier: selectedPlan,
  })) return res.status(409).json({
    error: "You already have an active booking or class plan matching this selection.",
    code: "DUPLICATE_ACTIVE_PURCHASE",
  });
  await revalidateAppliedPromo(purchase);

  purchase.paymentMethod = "Cash";
  purchase.status = "pending_payment";
  purchase.enrollmentStatus = null;
  purchase.cashConfirmationTokenHash = undefined;
  purchase.cashConfirmationExpiresAt = null;
  await purchase.save();
  try {
    const pending = await confirmCashEnrollment(purchase._id);
    res.json({
      order: pending.toPublic(),
      message: "Cash booking created. Payment is pending until confirmed by an Admin.",
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message, code: "CASH_BOOKING_FAILED" });
  }
}));

router.post("/cash-confirm", asyncHandler(async (req, res) => {
  const rawToken = String(req.body.token || "");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const existing = await GuestPurchase.findOne({ cashConfirmationTokenHash: tokenHash })
    .populate("tier session");
  if (!existing || !rawToken) return res.status(404).json({ error: "This confirmation link is invalid." });
  if (existing.cashConfirmationUsedAt || existing.enrollmentStatus === "enrolled") {
    return res.status(409).json({
      error: "This enrollment has already been confirmed.",
      code: "CASH_CONFIRM_ALREADY_USED",
      orderId: existing._id,
    });
  }
  if (!existing.cashConfirmationExpiresAt || existing.cashConfirmationExpiresAt <= new Date()) {
    existing.status = "expired";
    existing.enrollmentStatus = "expired";
    await existing.save();
    return res.status(410).json({ error: "This confirmation link has expired.", code: "CASH_CONFIRM_EXPIRED" });
  }
  if (!existing.tier?.active || !safeSession(existing.session) || !matchesClass(existing.tier, existing.session)) {
    return res.status(409).json({ error: "This Plan/Package is no longer available." });
  }
  if (existing.tier.firstTimerOnly && await hasPriorClientActivity(existing.email, {
    excludePurchaseId: existing._id,
  })) return res.status(409).json({
    error: "This plan is available for first-time clients only.", code: "FIRST_TIMER_ONLY",
  });
  if (await findActiveScheduleConflict({
    email: existing.email, session: existing.session, tier: existing.tier,
    excludePurchaseId: existing._id,
  })) return res.status(409).json({
    error: "You already have an active class with the same validity period, date, and time.",
    code: "ACTIVE_SCHEDULE_CONFLICT",
  });
  if (!existing.duplicateOverrideBy && await findActiveDuplicate({
    email: existing.email, session: existing.session, tier: existing.tier,
  })) return res.status(409).json({
    error: "You already have an active booking or class plan matching this selection.",
    code: "DUPLICATE_ACTIVE_PURCHASE",
  });

  const claimed = await GuestPurchase.findOneAndUpdate({
    _id: existing._id,
    cashConfirmationUsedAt: null,
    cashConfirmationExpiresAt: { $gt: new Date() },
    status: "pending_email_confirmation",
  }, {
    $set: {
      cashConfirmationUsedAt: new Date(),
      cashConfirmedAt: new Date(),
      status: "cash_confirmation_processing",
      enrollmentStatus: "confirmed",
    },
  }, { new: true });
  if (!claimed) {
    return res.status(409).json({ error: "This enrollment has already been confirmed.", code: "CASH_CONFIRM_ALREADY_USED" });
  }
  try {
    const order = await confirmCashEnrollment(claimed._id);
    res.json({ order: order.toPublic() });
  } catch (error) {
    await GuestPurchase.updateOne({ _id: claimed._id, booking: null }, {
      $set: {
        cashConfirmationUsedAt: null,
        cashConfirmedAt: null,
        status: "pending_email_confirmation",
        enrollmentStatus: "pending_email_confirmation",
      },
    });
    throw error;
  }
}));

router.get("/cash-payments", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const requestedStatus = String(req.query.status || "all").toLowerCase();
  const query = { paymentMethod: "Cash" };
  if (requestedStatus === "pending") {
    query.paidAt = null;
    query.status = { $in: ["pending_email_confirmation", "pending_cash_payment"] };
  } else if (requestedStatus === "paid") {
    query.paidAt = { $ne: null };
    query.status = { $in: ["confirmed", "waitlisted", "paid"] };
  } else if (requestedStatus === "cancelled") {
    query.status = "cancelled";
  }
  const purchases = await GuestPurchase.find(query)
    .sort("-createdAt")
    .populate("client", "name email phone")
    .populate("tier", "name")
    .populate({ path: "session", populate: { path: "instructor", select: "name" } })
    .populate("membership", "status currentPeriodEnd")
    .populate("paidBy", "name email")
    .populate("cancelledBy", "name email");
  const payments = purchases.map((purchase) => ({
    id: purchase._id,
    referenceId: purchase.referenceId,
    client: {
      id: purchase.client?._id || null,
      name: purchase.client?.name || purchase.fullName,
      email: purchase.client?.email || purchase.email,
      phone: purchase.client?.phone || purchase.phone,
    },
    planName: purchase.tier?.name || purchase.planSnapshot?.name || "Plan",
    className: purchase.session?.title || "—",
    instructorName: purchase.session?.instructor?.name || "—",
    scheduleStart: purchase.session?.startAt || null,
    amount: purchase.totalAmount,
    currency: purchase.currency,
    bookingDate: purchase.createdAt,
    paymentMethod: purchase.paymentMethod,
    paymentStatus: purchase.paidAt ? "paid" : purchase.status === "cancelled" ? "cancelled" : "pending",
    enrollmentStatus: purchase.paidAt || purchase.membership?.status === "active" ? "active"
      : purchase.enrollmentStatus || "pending_email_confirmation",
    paidAt: purchase.paidAt,
    paidBy: purchase.paidBy,
    paymentReference: purchase.paymentReference,
    paymentNotes: purchase.paymentNotes,
    cancelledAt: purchase.cancelledAt,
    cancelledBy: purchase.cancelledBy,
    cancellationNotes: purchase.cancellationNotes,
  }));
  res.json({ payments });
}));

router.post("/orders/:id/mark-cash-paid", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const purchase = await markCashPurchasePaid(req.params.id, {
    actorId: req.user._id,
    paymentReference: req.body?.paymentReference,
    notes: req.body?.notes,
  });
  await createAuditLog({
    actor: req.user,
    action: "CASH_PAYMENT_MARKED_PAID",
    description: `Marked cash payment ${purchase.referenceId} as Paid.`,
    entityType: "membership",
    entityId: purchase.membership?._id || purchase._id,
    entityLabel: purchase.referenceId,
    updatedValue: {
      paymentStatus: "paid",
      enrollmentStatus: "active",
      paidAt: purchase.paidAt,
      paidBy: req.user._id,
      paymentReference: purchase.paymentReference,
      notes: purchase.paymentNotes,
    },
  });
  res.json({ order: purchase.toPublic(), message: "Cash payment marked as Paid." });
}));

router.post("/orders/:id/cancel-cash-payment", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const purchase = await cancelCashPurchase(req.params.id, {
    actorId: req.user._id,
    notes: req.body?.notes,
  });
  await createAuditLog({
    actor: req.user,
    action: "CASH_PAYMENT_CANCELLED",
    description: `Cancelled pending cash payment ${purchase.referenceId}.`,
    entityType: "membership",
    entityId: purchase.membership?._id || purchase._id,
    entityLabel: purchase.referenceId,
    updatedValue: {
      paymentStatus: "cancelled",
      enrollmentStatus: "cancelled",
      cancelledAt: purchase.cancelledAt,
      cancelledBy: req.user._id,
      notes: purchase.cancellationNotes,
    },
  });
  res.json({ order: purchase.toPublic(), message: "Cash payment cancelled." });
}));

router.post("/orders/:id/simulate-success", asyncHandler(async (req, res) => {
  const purchase = await loadAuthorizedOrder(req);
  if (purchase.planSnapshot?.directCash === true) {
    return res.status(409).json({
      error: "Cash Payment bookings must be marked as Paid by an Admin.",
      code: "PAYMENT_METHOD_LOCKED",
    });
  }
  if (xendit.isLive() || process.env.XENDIT_SIMULATION !== "true") {
    return res.status(404).json({ error: "Not found" });
  }
  purchase.simulated = true;
  await purchase.save();
  const fulfilled = await fulfillGuestPurchase(purchase._id, { paymentId: `sim_payment_${purchase._id}` });
  res.json({ order: fulfilled.toPublic() });
}));

export default router;
