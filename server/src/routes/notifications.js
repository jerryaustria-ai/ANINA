import { Router } from "express";
import { Notification } from "../models/Notification.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { Booking } from "../models/Booking.js";
import { createNotification } from "../services/notifications.js";

const router = Router();
router.use(requireAuth);

async function ensureClassReminders(user) {
  if (user.role !== "client") return;
  const now = new Date();
  const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const bookings = await Booking.find({ client: user._id, status: "accepted" }).populate("session");
  const upcoming = bookings.filter((booking) =>
    booking.session &&
    booking.session.status === "published" &&
    booking.session.isPublished === true &&
    booking.session.startAt > now &&
    booking.session.startAt <= cutoff
  );
  await Promise.all(upcoming.map((booking) => createNotification({
    recipient: user,
    type: "CLASS_REMINDER",
    title: "Class Reminder",
    message: `${booking.session.title} starts ${booking.session.startAt.toLocaleString("en-PH", { timeZone: process.env.APP_TIMEZONE || "Asia/Manila" })}.`,
    relatedBookingId: booking._id,
    relatedScheduleId: booking.session._id,
    eventKey: `class-reminder:${booking._id}:${booking.session.startAt.toISOString()}`,
  })));
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    await ensureClassReminders(req.user);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const notifications = await Notification.find({ recipientId: req.user._id })
      .sort("-createdAt")
      .limit(limit);
    res.json({ notifications: notifications.map((item) => item.toPublic()) });
  })
);

router.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const count = await Notification.countDocuments({ recipientId: req.user._id, isRead: false });
    res.json({ count });
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const readAt = new Date();
    let notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientId: req.user._id, isRead: false },
      { $set: { isRead: true, readAt } },
      { new: true }
    );
    // Marking an already-read notification again must not restart its
    // 24-hour retention window.
    if (!notification) {
      notification = await Notification.findOne({
        _id: req.params.id,
        recipientId: req.user._id,
      });
    }
    if (!notification) throw new HttpError(404, "Notification not found");
    res.json({ notification: notification.toPublic() });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const readAt = new Date();
    const result = await Notification.updateMany(
      { recipientId: req.user._id, isRead: false },
      { $set: { isRead: true, readAt } }
    );
    res.json({ ok: true, updated: result.modifiedCount });
  })
);

export default router;
