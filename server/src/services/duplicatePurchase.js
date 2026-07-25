import { Booking } from "../models/Booking.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { Membership } from "../models/Membership.js";
import { User } from "../models/User.js";

export async function findActiveDuplicate({ email, session, tier }) {
  const user = await User.findOne({ email: String(email || "").trim().toLowerCase() });
  if (!user) return null;

  const now = new Date();
  const [membership, classBooking] = await Promise.all([
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
      status: { $in: ["pending", "accepted", "waitlisted"] },
    }).populate("purchase").sort("-createdAt"),
  ]);

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
