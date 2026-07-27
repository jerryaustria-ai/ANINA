import { Booking } from "../models/Booking.js";
import { ClassSession } from "../models/ClassSession.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { Membership } from "../models/Membership.js";
import { User } from "../models/User.js";

const SUCCESSFUL_PURCHASE_STATUSES = [
  "paid",
  "pending_confirmation",
  "confirmed",
  "waitlisted",
  "refunded",
];

export async function hasPriorClientActivity(email, { excludePurchaseId = null } = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select("_id bookingHistory purchaseCount");

  const completedSessionIds = user
    ? await ClassSession.find({
      $or: [
        { status: "completed" },
        { endAt: { $lte: new Date() } },
      ],
    }).distinct("_id")
    : [];

  const [successfulPurchase, membership, completedBooking, paidBooking] = await Promise.all([
    GuestPurchase.exists({
      _id: excludePurchaseId ? { $ne: excludePurchaseId } : { $exists: true },
      email: normalizedEmail,
      $or: [
        { paidAt: { $ne: null } },
        { status: { $in: SUCCESSFUL_PURCHASE_STATUSES } },
      ],
    }),
    user ? Membership.exists({
      client: user._id,
      status: { $in: ["active", "past_due", "cancelled", "inactive"] },
    }) : null,
    user ? Booking.exists({
      client: user._id,
      $or: [
        { status: { $in: ["attended", "no_show"] } },
        {
          session: { $in: completedSessionIds },
          status: { $in: ["accepted", "attended", "no_show"] },
        },
      ],
    }) : null,
    user ? Booking.exists({ client: user._id, paymentStatus: { $in: ["paid", "refunded"] } }) : null,
  ]);

  return Boolean(
    user?.bookingHistory?.length ||
    user?.purchaseCount > 0 ||
    successfulPurchase ||
    membership ||
    completedBooking ||
    paidBooking
  );
}
