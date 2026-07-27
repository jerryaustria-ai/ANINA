import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { asyncHandler } from "../utils/http.js";
import { redeemCheckInToken } from "../services/checkIn.js";

const router = Router();
router.use(requireAuth, requireRole("admin", "instructor"));

router.post("/scan", asyncHandler(async (req, res) => {
  const booking = await redeemCheckInToken({
    token: req.body?.token,
    actor: req.user,
    expectedSessionId: req.body?.sessionId || null,
  });
  res.json({
    message: `${booking.client?.name || "Client"} checked in successfully.`,
    checkIn: {
      bookingId: booking._id,
      clientName: booking.client?.name,
      className: booking.session?.title,
      checkedInAt: booking.checkInUsedAt,
      attendanceStatus: "Present",
      fullyUsed: new Date(booking.session?.endAt) <= new Date(),
    },
  });
}));

export default router;
