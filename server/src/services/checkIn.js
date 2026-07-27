import crypto from "node:crypto";
import { Booking } from "../models/Booking.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { Membership } from "../models/Membership.js";

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const signingSecret = () => process.env.CHECK_IN_TOKEN_SECRET || process.env.JWT_SECRET || "";

export async function issueCheckInToken(bookingId) {
  const secret = signingSecret();
  if (!secret) throw new Error("CHECK_IN_TOKEN_SECRET or JWT_SECRET must be configured.");
  const nonce = crypto.randomBytes(32).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(nonce).digest("base64url");
  const token = `${nonce}.${signature}`;
  await Booking.updateOne({ _id: bookingId }, {
    $set: { checkInTokenHash: hashToken(token), checkInTokenIssuedAt: new Date() },
  });
  return token;
}

export async function redeemCheckInToken({ token, actor, expectedSessionId = null }) {
  const secret = signingSecret();
  const [nonce, signature] = String(token || "").trim().split(".");
  if (!secret || !nonce || !signature) throw Object.assign(new Error("Invalid QR check-in code."), { status: 400 });
  const expectedSignature = crypto.createHmac("sha256", secret).update(nonce).digest("base64url");
  const given = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw Object.assign(new Error("Invalid QR check-in code."), { status: 400 });
  }

  const tokenHash = hashToken(token);
  const booking = await Booking.findOne({ checkInTokenHash: tokenHash })
    .select("+checkInTokenHash")
    .populate("client", "name email active")
    .populate({ path: "session", populate: [{ path: "instructor", select: "name" }, { path: "room", select: "name location" }] });
  if (!booking) throw Object.assign(new Error("This QR code is invalid or expired."), { status: 404 });
  if (booking.checkInUsedAt) throw Object.assign(new Error("This QR code has already been used."), { status: 409 });
  if (!booking.client?.active) throw Object.assign(new Error("The client account is inactive."), { status: 409 });
  if (expectedSessionId && String(booking.session?._id) !== String(expectedSessionId)) {
    throw Object.assign(new Error("This QR code belongs to another class."), { status: 409 });
  }
  if (actor.role === "instructor" && String(booking.session?.instructor?._id) !== String(actor._id)) {
    throw Object.assign(new Error("This QR code belongs to a class assigned to another instructor."), { status: 403 });
  }
  if (booking.paymentStatus !== "paid") throw Object.assign(new Error("This booking has not been successfully paid."), { status: 409 });
  if (!["accepted"].includes(booking.status)) {
    throw Object.assign(new Error("This booking is cancelled, inactive, or no longer available for check-in."), { status: 409 });
  }
  if (booking.session?.status === "cancelled") throw Object.assign(new Error("This class has been cancelled."), { status: 409 });

  const purchase = booking.purchase ? await GuestPurchase.findById(booking.purchase) : null;
  if (purchase && (purchase.refundedAt || ["refunded", "cancelled", "failed", "declined"].includes(purchase.status))) {
    throw Object.assign(new Error("This booking is refunded, cancelled, or inactive."), { status: 409 });
  }
  const membership = purchase?.membership ? await Membership.findById(purchase.membership) : null;
  if (membership && (membership.status !== "active" ||
      (membership.currentPeriodEnd && membership.currentPeriodEnd <= new Date()))) {
    throw Object.assign(new Error("This class plan is inactive or expired."), { status: 409 });
  }

  const now = new Date();
  const recordedAttendance = booking.status === "attended" ? "present" : booking.attendanceStatus;
  if (recordedAttendance === "present" && new Date(booking.session.endAt) <= now) {
    throw Object.assign(new Error("This booking has already been fully used."), { status: 409 });
  }
  const earlyMinutes = Math.max(0, Number(process.env.CHECK_IN_EARLY_MINUTES || 30));
  const lateMinutes = Math.max(0, Number(process.env.CHECK_IN_LATE_MINUTES || 30));
  const opensAt = new Date(new Date(booking.session.startAt).getTime() - earlyMinutes * 60000);
  const closesAt = new Date(new Date(booking.session.endAt).getTime() + lateMinutes * 60000);
  if (now < opensAt) throw Object.assign(new Error(`Check-in opens ${earlyMinutes} minutes before class.`), { status: 409 });
  if (now > closesAt) throw Object.assign(new Error("This QR code has expired for the scheduled class."), { status: 409 });

  const checkedIn = await Booking.findOneAndUpdate(
    { _id: booking._id, checkInTokenHash: tokenHash, checkInUsedAt: null, status: "accepted", paymentStatus: "paid" },
    {
      $set: {
        checkInUsedAt: now,
        checkedInBy: actor._id,
        attendanceStatus: "present",
        attendanceRecordedAt: now,
        attendanceRecordedBy: actor._id,
      },
    },
    { new: true }
  ).populate("client", "name email").populate("session", "title startAt endAt");
  if (!checkedIn) throw Object.assign(new Error("This QR code has already been used or the booking is no longer active."), { status: 409 });
  return checkedIn;
}
