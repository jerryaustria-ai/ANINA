import { Booking } from "../models/Booking.js";
import { ClassSession } from "../models/ClassSession.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { Membership } from "../models/Membership.js";
import { User } from "../models/User.js";
import { claimSeat, releaseSeat } from "./capacity.js";
import {
  sendCashEnrollmentConfirmedEmail,
  sendPurchaseStatusEmailOnce,
} from "./email.js";
import { createNotification, notifyAdmins } from "./notifications.js";
import QRCode from "qrcode";
import { issueCheckInToken } from "./checkIn.js";
import { reserveMembershipCredit } from "./membership.js";

function periodEnd(tier) {
  const date = new Date();
  const count = tier.intervalCount || 1;
  if (tier.interval === "DAY") date.setDate(date.getDate() + count);
  if (tier.interval === "WEEK") date.setDate(date.getDate() + count * 7);
  if (tier.interval === "MONTH") date.setMonth(date.getMonth() + count);
  if (tier.interval === "YEAR") date.setFullYear(date.getFullYear() + count);
  return date;
}

async function findOrCreateCustomer(purchase) {
  const update = {
    $set: { name: purchase.fullName, phone: purchase.phone },
    $setOnInsert: { role: "client", active: true },
  };
  try {
    return await User.findOneAndUpdate(
      { email: purchase.email },
      update,
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // A unique email index protects against two successful first purchases
    // arriving at the same time. Re-read the winner instead of creating a
    // duplicate customer.
    if (error.code !== 11000) throw error;
    return User.findOneAndUpdate(
      { email: purchase.email },
      { $set: { name: purchase.fullName, phone: purchase.phone } },
      { new: true, runValidators: true }
    );
  }
}

async function saveSuccessfulBookingHistory({ client, purchase, booking, membership, session }) {
  const tier = purchase.tier;
  const history = {
    purchase: purchase._id,
    booking: booking._id,
    membership: membership._id,
    bookingReference: purchase.referenceId,
    customerName: purchase.fullName,
    email: purchase.email,
    phone: purchase.phone,
    className: session.title,
    scheduleStart: session.startAt,
    scheduleEnd: session.endAt,
    purchasedPlan: purchase.planSnapshot.name,
    numberOfSessions: tier.unlimitedClasses ? null : (tier.sessionCount || 1),
    unlimitedClasses: !!tier.unlimitedClasses,
    validityInterval: tier.interval,
    validityIntervalCount: tier.intervalCount || 1,
    validUntil: membership.currentPeriodEnd,
    amountPaid: purchase.totalAmount,
    currency: purchase.currency,
    paymentMethod: purchase.paymentMethod || "Xendit",
    paymentStatus: "successful",
    paymentDate: purchase.paidAt,
    bookingDate: purchase.createdAt,
  };

  // The purchase condition makes webhook retries idempotent.
  await User.updateOne(
    { _id: client._id, "bookingHistory.purchase": { $ne: purchase._id } },
    {
      $push: { bookingHistory: history },
      $set: { lastGuestPurchase: purchase._id },
      $inc: { purchaseCount: 1 },
    }
  );
}

async function performFulfillment(purchaseId, payment = {}) {
  let purchase = await GuestPurchase.findById(purchaseId).populate("tier session");
  if (!purchase) throw Object.assign(new Error("Purchase not found."), { status: 404 });
  const cashPending = payment.cashPending === true;
  if (purchase.booking && ["confirmed", "waitlisted", "pending_cash_payment"].includes(purchase.status)) return purchase;

  purchase.status = cashPending ? "pending_cash_payment" : "paid";
  if (!cashPending) purchase.paidAt ||= new Date();
  purchase.paymentId = payment.paymentId || purchase.paymentId;
  purchase.paymentMethod = cashPending ? "Cash" : purchase.paymentMethod;
  await purchase.save();

  const client = await findOrCreateCustomer(purchase);

  const session = await ClassSession.findById(purchase.session._id).populate("instructor room");
  if (!session) throw Object.assign(new Error("The selected class no longer exists."), { status: 409 });
  let booking = await Booking.findOne({ session: session._id, client: client._id });
  let bookingStatus = booking?.status;
  if (!booking || !["accepted", "waitlisted"].includes(booking.status)) {
    const seat = await claimSeat(session._id);
    bookingStatus = seat ? "accepted" : "waitlisted";
    booking = await Booking.findOneAndUpdate(
      { session: session._id, client: client._id },
      {
        $set: {
          status: bookingStatus,
          source: "guest_checkout",
          paymentStatus: cashPending ? "pending" : "paid",
          purchase: purchase._id,
          note: cashPending
            ? "Created after cash enrollment email confirmation; payment is pending."
            : "Created after successful guest checkout.",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } else if (!cashPending && booking.paymentStatus !== "paid") {
    booking.paymentStatus = "paid";
    booking.purchase = purchase._id;
    await booking.save();
  }

  let membership = purchase.membership
    ? await Membership.findById(purchase.membership)
    : null;
  if (!membership) {
    const included = purchase.tier.unlimitedClasses ? null : (purchase.tier.sessionCount || 1);
    membership = await Membership.create({
      client: client._id,
      tier: purchase.tier._id,
      status: cashPending ? "pending" : "active",
      source: "guest_checkout",
      referenceId: purchase.referenceId,
      currentPeriodEnd: periodEnd(purchase.tier),
      sessionsIncluded: included,
      sessionsRemaining: included,
      sessionsReserved: 0,
      unlimitedClasses: purchase.tier.unlimitedClasses,
      validClassTags: purchase.tier.classTags,
      validClassIds: purchase.tier.eligibleClassIds,
      cycleCount: 1,
      lastEvent: cashPending ? "cash_enrollment.confirmed" : "payment_session.completed",
      simulated: purchase.simulated,
    });
  }
  if (!cashPending && bookingStatus === "accepted" &&
      booking.creditStatus !== "reserved" && booking.creditStatus !== "consumed") {
    const reserved = await reserveMembershipCredit(membership._id);
    if (!reserved) throw Object.assign(new Error("The purchased plan has no available class credit."), { status: 409 });
    booking.membership = membership._id;
    booking.creditStatus = "reserved";
    await booking.save();
  } else if (!booking.membership) {
    booking.membership = membership._id;
    await booking.save();
  }

  purchase.client = client._id;
  purchase.booking = booking._id;
  purchase.membership = membership._id;
  purchase.status = cashPending
    ? "pending_cash_payment"
    : bookingStatus === "accepted" ? "confirmed" : "waitlisted";
  purchase.enrollmentStatus = "enrolled";
  await purchase.save();
  if (!cashPending) {
    await saveSuccessfulBookingHistory({ client, purchase, booking, membership, session });
  }
  let qrCodeBase64 = "";
  if (!cashPending && bookingStatus === "accepted") {
    const checkInToken = await issueCheckInToken(booking._id);
    const qrDataUrl = await QRCode.toDataURL(checkInToken, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 440,
    });
    qrCodeBase64 = qrDataUrl.split(",")[1] || "";
  }

  await Promise.all([
    createNotification({
      recipient: client,
      type: "BOOKING_CONFIRMED",
      title: cashPending ? "Cash Enrollment Confirmed"
        : bookingStatus === "accepted" ? "Booking Confirmed" : "Added to Waitlist",
      message: cashPending
        ? `${session.title} is enrolled with Pending Cash Payment.`
        : `${session.title} payment was received.`,
      relatedBookingId: booking._id,
      relatedScheduleId: session._id,
      eventKey: `guest-paid-${purchase._id}`,
    }),
    notifyAdmins({
      type: "BOOKING_CONFIRMED",
      title: cashPending ? "Cash Enrollment Confirmed" : "Guest Booking Paid",
      message: cashPending
        ? `${purchase.fullName} confirmed cash enrollment for ${purchase.planSnapshot.name}. Payment is pending.`
        : `${purchase.fullName} purchased ${purchase.planSnapshot.name} for ${session.title}.`,
      relatedUserId: client._id,
      relatedBookingId: booking._id,
      relatedScheduleId: session._id,
      eventKey: `guest-paid-admin-${purchase._id}`,
    }),
  ]);

  try {
    if (cashPending) await sendCashEnrollmentConfirmedEmail(purchase);
    else await sendPurchaseStatusEmailOnce(
        purchase._id,
        "payment_successful",
        `payment-successful:${purchase.paymentId || purchase.referenceId}`,
        { paymentDate: purchase.paidAt, receiptUrl: purchase.receiptUrl, qrCodeBase64 }
      );
  } catch (error) {
    console.warn("Guest confirmation email failed:", error.message);
  }
  return purchase.populate("session tier booking membership");
}

export async function confirmCashEnrollment(purchaseId) {
  return performFulfillment(purchaseId, { cashPending: true });
}

export async function markCashPurchasePaid(purchaseId, { actorId, paymentReference = "", notes = "" } = {}) {
  const purchase = await GuestPurchase.findOne({
    _id: purchaseId,
    paymentMethod: "Cash",
    status: "pending_cash_payment",
    enrollmentStatus: "enrolled",
  }).populate("tier session booking membership client");
  if (!purchase) throw Object.assign(new Error("Pending cash enrollment not found."), { status: 404 });

  purchase.paidAt = new Date();
  purchase.paidBy = actorId || null;
  purchase.paymentReference = String(paymentReference || "").trim();
  purchase.paymentNotes = String(notes || "").trim();
  purchase.status = purchase.booking?.status === "waitlisted" ? "waitlisted" : "confirmed";
  purchase.paymentId ||= `cash_${purchase._id}`;
  purchase.booking.paymentStatus = "paid";
  purchase.membership.status = "active";
  purchase.membership.currentPeriodEnd = periodEnd(purchase.tier);
  purchase.membership.lastEvent = "cash_payment.received";
  await purchase.membership.save();
  if (purchase.booking.status === "accepted" &&
      purchase.booking.creditStatus !== "reserved" &&
      purchase.booking.creditStatus !== "consumed") {
    const reserved = await reserveMembershipCredit(purchase.membership._id);
    if (!reserved) throw Object.assign(new Error("The purchased plan has no available class credit."), { status: 409 });
    purchase.booking.creditStatus = "reserved";
  }
  await purchase.booking.save();
  await purchase.save();
  await saveSuccessfulBookingHistory({
    client: purchase.client,
    purchase,
    booking: purchase.booking,
    membership: purchase.membership,
    session: purchase.session,
  });

  let qrCodeBase64 = "";
  if (purchase.booking.status === "accepted") {
    const checkInToken = await issueCheckInToken(purchase.booking._id);
    const qrDataUrl = await QRCode.toDataURL(checkInToken, {
      errorCorrectionLevel: "M", margin: 2, width: 440,
    });
    qrCodeBase64 = qrDataUrl.split(",")[1] || "";
  }
  await sendPurchaseStatusEmailOnce(
    purchase._id,
    "payment_successful",
    `cash-paid:${purchase._id}`,
    { paymentDate: purchase.paidAt, qrCodeBase64 }
  ).catch((error) => console.warn("Cash payment confirmation email failed:", error.message));
  return purchase;
}

export async function cancelCashPurchase(purchaseId, { actorId, notes = "" } = {}) {
  const purchase = await GuestPurchase.findOne({
    _id: purchaseId,
    paymentMethod: "Cash",
    paidAt: null,
    status: { $in: ["pending_email_confirmation", "pending_cash_payment"] },
  }).populate("tier session booking membership client");
  if (!purchase) throw Object.assign(new Error("Pending cash payment not found."), { status: 404 });

  const cancelledAt = new Date();
  if (purchase.booking) {
    if (purchase.booking.status === "accepted") await releaseSeat(purchase.session._id);
    purchase.booking.status = "cancelled";
    purchase.booking.paymentStatus = "unpaid";
    purchase.booking.note = "Cash payment enrollment cancelled by Admin.";
    await purchase.booking.save();
  }
  if (purchase.membership) {
    purchase.membership.status = "cancelled";
    purchase.membership.lastEvent = "cash_payment.cancelled";
    await purchase.membership.save();
  }
  purchase.status = "cancelled";
  purchase.enrollmentStatus = "cancelled";
  purchase.cancelledAt = cancelledAt;
  purchase.cancelledBy = actorId || null;
  purchase.cancellationNotes = String(notes || "").trim();
  purchase.cashConfirmationTokenHash = undefined;
  purchase.cashConfirmationExpiresAt = null;
  await purchase.save();

  await sendPurchaseStatusEmailOnce(
    purchase._id,
    "booking_cancelled",
    `cash-payment-cancelled:${purchase._id}:${cancelledAt.toISOString()}`,
    { cancelledAt }
  ).catch((error) => console.warn("Cash cancellation email failed:", error.message));
  return purchase;
}

export async function fulfillGuestPurchase(purchaseId, payment = {}) {
  const locked = await GuestPurchase.findOneAndUpdate(
    {
      _id: purchaseId,
      booking: null,
      status: { $in: ["pending_payment", "payment_pending", "paid", "failed", "declined"] },
    },
    { $set: { status: "pending_confirmation", processingAt: new Date() } },
    { new: true }
  );
  if (!locked) {
    const existing = await GuestPurchase.findById(purchaseId).populate("session tier booking membership client");
    if (existing && ["confirmed", "waitlisted"].includes(existing.status) &&
        existing.client && existing.booking && existing.membership && existing.session) {
      await saveSuccessfulBookingHistory({
        client: existing.client,
        purchase: existing,
        booking: existing.booking,
        membership: existing.membership,
        session: existing.session,
      });
    }
    return existing;
  }
  try {
    const purchase = await performFulfillment(purchaseId, payment);
    purchase.processingAt = null;
    await purchase.save();
    return purchase;
  } catch (error) {
    await GuestPurchase.updateOne(
      { _id: purchaseId, booking: null },
      { $set: { status: "failed", processingAt: null } }
    );
    throw error;
  }
}
