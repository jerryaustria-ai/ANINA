import { Booking } from "../models/Booking.js";
import { ClassSession } from "../models/ClassSession.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { Membership } from "../models/Membership.js";
import { User } from "../models/User.js";
import { claimSeat } from "./capacity.js";
import { sendPurchaseStatusEmailOnce } from "./email.js";
import { createNotification, notifyAdmins } from "./notifications.js";
import QRCode from "qrcode";
import { issueCheckInToken } from "./checkIn.js";

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
  if (purchase.booking && ["confirmed", "waitlisted"].includes(purchase.status)) return purchase;

  purchase.status = "paid";
  purchase.paidAt ||= new Date();
  purchase.paymentId = payment.paymentId || purchase.paymentId;
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
          paymentStatus: "paid",
          purchase: purchase._id,
          note: "Created after successful guest checkout.",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } else if (booking.paymentStatus !== "paid") {
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
      status: "active",
      source: "guest_checkout",
      referenceId: purchase.referenceId,
      currentPeriodEnd: periodEnd(purchase.tier),
      sessionsIncluded: included,
      sessionsRemaining: included === null ? null : Math.max(0, included - (bookingStatus === "accepted" ? 1 : 0)),
      unlimitedClasses: purchase.tier.unlimitedClasses,
      validClassTags: purchase.tier.classTags,
      cycleCount: 1,
      lastEvent: "payment_session.completed",
      simulated: purchase.simulated,
    });
  }

  purchase.client = client._id;
  purchase.booking = booking._id;
  purchase.membership = membership._id;
  purchase.status = bookingStatus === "accepted" ? "confirmed" : "waitlisted";
  await purchase.save();
  await saveSuccessfulBookingHistory({ client, purchase, booking, membership, session });
  let qrCodeBase64 = "";
  if (bookingStatus === "accepted") {
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
      title: bookingStatus === "accepted" ? "Booking Confirmed" : "Added to Waitlist",
      message: `${session.title} payment was received.`,
      relatedBookingId: booking._id,
      relatedScheduleId: session._id,
      eventKey: `guest-paid-${purchase._id}`,
    }),
    notifyAdmins({
      type: "BOOKING_CONFIRMED",
      title: "Guest Booking Paid",
      message: `${purchase.fullName} purchased ${purchase.planSnapshot.name} for ${session.title}.`,
      relatedUserId: client._id,
      relatedBookingId: booking._id,
      relatedScheduleId: session._id,
      eventKey: `guest-paid-admin-${purchase._id}`,
    }),
  ]);

  try {
    await sendPurchaseStatusEmailOnce(
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
