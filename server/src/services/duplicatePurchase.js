import { Booking } from "../models/Booking.js";
import { ClassSession } from "../models/ClassSession.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { Membership } from "../models/Membership.js";
import { User } from "../models/User.js";

const ACTIVE_BOOKING_STATUSES = ["pending", "accepted", "waitlisted"];
const ACTIVE_PURCHASE_STATUSES = [
  "paid",
  "pending_confirmation",
  "confirmed",
  "waitlisted",
];

function validityDays(plan) {
  const count = Math.max(1, Number(plan?.intervalCount || 1));
  const multipliers = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };
  return count * (multipliers[String(plan?.interval || "MONTH").toUpperCase()] || 30);
}

export async function findActiveScheduleConflict({ email, session, tier, excludePurchaseId = null }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select("_id");
  const selectedValidityDays = validityDays(tier);

  // This duplicate rule is intentionally exact: both start/end time and
  // normalized validity days must match.
  const conflictingSessionIds = await ClassSession.find({
    startAt: session.startAt,
    endAt: session.endAt,
    status: { $in: ["open", "confirmed", "rescheduled", "published"] },
  }).distinct("_id");

  const [bookings, purchases] = await Promise.all([
    user ? Booking.find({
      client: user._id,
      session: { $in: conflictingSessionIds },
      status: { $in: ACTIVE_BOOKING_STATUSES },
    }).populate("session purchase").sort("-createdAt") : [],
    GuestPurchase.find({
      _id: excludePurchaseId ? { $ne: excludePurchaseId } : { $exists: true },
      email: normalizedEmail,
      session: { $in: conflictingSessionIds },
      status: { $in: ACTIVE_PURCHASE_STATUSES },
    }).populate("session").sort("-createdAt"),
  ]);

  const booking = bookings.find((item) =>
    item.purchase?.planSnapshot &&
    validityDays(item.purchase.planSnapshot) === selectedValidityDays
  );
  const purchase = purchases.find((item) =>
    validityDays(item.planSnapshot) === selectedValidityDays
  );
  if (!booking && !purchase) return null;

  const conflictingSession = booking?.session || purchase?.session;
  const linkedPurchase = booking?.purchase;
  return {
    conflict: true,
    existingBookingId: booking?._id || null,
    bookingReference: linkedPurchase?.referenceId || purchase?.referenceId || null,
    className: conflictingSession?.title || session.title,
    startAt: conflictingSession?.startAt || session.startAt,
    endAt: conflictingSession?.endAt || session.endAt,
    validityDays: selectedValidityDays,
  };
}

export async function findActiveDuplicate({ email, session, tier }) {
  const user = await User.findOne({ email: String(email || "").trim().toLowerCase() });
  if (!user) return null;

  const now = new Date();
  const [membership, sameSessionBooking] = await Promise.all([
    Membership.findOne({
      client: user._id,
      tier: tier._id,
      status: "active",
      $and: [
        { $or: [{ currentPeriodEnd: null }, { currentPeriodEnd: { $gt: now } }] },
        { $or: [{ unlimitedClasses: true }, { sessionsRemaining: null }, { sessionsRemaining: { $gt: 0 } }] },
      ],
    }).populate("tier").sort("-createdAt"),
    Booking.findOne({
      client: user._id,
      session: session._id,
      status: { $in: ACTIVE_BOOKING_STATUSES },
    }).populate("purchase").sort("-createdAt"),
  ]);

  // A session may offer multiple plans. Treat it as the exact same booked
  // class only when its linked purchase uses the selected plan as well.
  // Legacy/non-purchase bookings have no plan ID, so their active seat still
  // blocks another booking for that exact session.
  const bookedPlanId = sameSessionBooking?.purchase?.tier;
  const classBooking = sameSessionBooking && (
    !bookedPlanId || String(bookedPlanId) === String(tier._id)
  ) ? sameSessionBooking : null;

  if (!membership && !classBooking) return null;

  let purchase = classBooking?.purchase || null;
  if (!purchase && membership) {
    purchase = await GuestPurchase.findOne({ membership: membership._id }).sort("-paidAt -createdAt");
  }

  return {
    duplicate: true,
    duplicateTypes: [
      ...(membership ? ["plan"] : []),
      ...(classBooking ? ["class"] : []),
    ],
    existingPlanName: membership?.tier?.name || purchase?.planSnapshot?.name || null,
    remainingSessions: membership
      ? (membership.unlimitedClasses || membership.sessionsRemaining == null
          ? "Unlimited"
          : membership.sessionsRemaining)
      : null,
    expirationDate: membership?.currentPeriodEnd || null,
    bookingReference: purchase?.referenceId || null,
    existingBookingId: classBooking?._id || null,
  };
}
