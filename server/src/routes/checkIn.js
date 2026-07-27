import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler } from "../utils/http.js";
import { redeemCheckInToken } from "../services/checkIn.js";
import { createAuditLog } from "../services/audit.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "instructor"));

router.post("/scan", asyncHandler(async (req, res) => {
  const booking = await redeemCheckInToken({
    token: req.body?.token,
    actor: req.user,
    expectedSessionId: req.body?.sessionId || null,
  });
  await createAuditLog({
    actor: req.user,
    action: "BOOKING_QR_CHECKED_IN",
    description: `${booking.client?.name || "Client"} checked in to ${booking.session?.title || "a class"} by QR code.`,
    entityType: "booking",
    entityId: booking._id,
    entityLabel: `${booking.session?.title || "Booking"} — ${booking._id}`,
    updatedValue: {
      attendanceStatus: "present",
      checkInUsedAt: booking.checkInUsedAt,
      checkedInBy: req.user._id,
    },
    metadata: {
      scheduleId: booking.session?._id,
      clientId: booking.client?._id,
    },
  });
  res.json({
    message: `${booking.client?.name || "Client"} checked in successfully.`,
    checkIn: {
      bookingId: booking._id,
      clientName: booking.client?.name,
      className: booking.session?.title,
      checkedInAt: booking.checkInUsedAt,
      attendanceStatus: "Present",
      bookingStatus: new Date(booking.session?.endAt) <= new Date() ? "Fully Used" : "Present",
      fullyUsed: new Date(booking.session?.endAt) <= new Date(),
    },
  });
}));

export default router;
