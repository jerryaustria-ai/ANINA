import { Router } from "express";
import { Booking } from "../models/Booking.js";
import { ClassSession } from "../models/ClassSession.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { claimSeat, releaseSeat } from "../services/capacity.js";
import { hasActiveMembership } from "../services/membership.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);

const isOwnerInstructor = (req, session) =>
  req.user.role === "admin" || session.instructor.toString() === req.user._id.toString();

// POST /api/bookings  { sessionId, note }  — client requests a seat (pending).
router.post(
  "/",
  requireRole("client", "admin"),
  asyncHandler(async (req, res) => {
    const { sessionId, note } = req.body || {};

    // Gate: clients must hold an active membership to book. (Admin exempt.)
    if (req.user.role === "client" && !(await hasActiveMembership(req.user._id))) {
      throw new HttpError(402, "An active membership is required to book classes");
    }

    const session = await ClassSession.findById(sessionId);
    if (!session) throw new HttpError(404, "Session not found");
    if (!["open", "confirmed"].includes(session.status)) {
      throw new HttpError(400, "This class is not open for booking");
    }
    if (new Date(session.startAt) < new Date()) throw new HttpError(400, "That class has already started");

    const clientId = req.user._id;
    const existing = await Booking.findOne({ session: sessionId, client: clientId });
    if (existing && !["cancelled", "declined"].includes(existing.status)) {
      throw new HttpError(409, "You already have a booking for this class");
    }

    let booking;
    if (existing) {
      existing.status = "pending";
      existing.note = note || "";
      booking = await existing.save();
    } else {
      booking = await Booking.create({ session: sessionId, client: clientId, note: note || "", status: "pending" });
    }
    res.status(201).json({ booking: booking.toPublic() });
  })
);

// GET /api/bookings/mine — the signed-in client's bookings.
router.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const bookings = await Booking.find({ client: req.user._id })
      .populate({ path: "session", populate: [{ path: "instructor", select: "name picture" }, { path: "room", select: "name color" }] })
      .sort("-createdAt");
    res.json({ bookings: bookings.map((b) => b.toPublic()) });
  })
);

// Helper for instructor/admin decisions on a booking.
async function loadForDecision(req) {
  const booking = await Booking.findById(req.params.id).populate("session");
  if (!booking) throw new HttpError(404, "Booking not found");
  if (!isOwnerInstructor(req, booking.session)) throw new HttpError(403, "Not your class");
  return booking;
}

// POST /api/bookings/:id/accept — claims a seat atomically; full class -> waitlist.
router.post(
  "/:id/accept",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const booking = await loadForDecision(req);
    if (booking.status === "accepted") return res.json({ booking: booking.toPublic() });

    const seat = await claimSeat(booking.session._id);
    if (!seat) {
      booking.status = "waitlisted";
      await booking.save();
      return res.status(200).json({ booking: booking.toPublic(), waitlisted: true, reason: "class full" });
    }
    booking.status = "accepted";
    await booking.save();
    res.json({ booking: booking.toPublic(), seatsLeft: Math.max(0, seat.capacity - seat.acceptedCount) });
  })
);

// POST /api/bookings/:id/decline
router.post(
  "/:id/decline",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const booking = await loadForDecision(req);
    if (booking.status === "accepted") await releaseSeat(booking.session._id);
    booking.status = "declined";
    await booking.save();
    res.json({ booking: booking.toPublic() });
  })
);

// POST /api/bookings/:id/waitlist
router.post(
  "/:id/waitlist",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const booking = await loadForDecision(req);
    if (booking.status === "accepted") await releaseSeat(booking.session._id);
    booking.status = "waitlisted";
    await booking.save();
    res.json({ booking: booking.toPublic() });
  })
);

// POST /api/bookings/:id/cancel — client cancels own booking (frees a seat).
router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const booking = await Booking.findById(req.params.id).populate("session");
    if (!booking) throw new HttpError(404, "Booking not found");
    const isOwnerClient = booking.client.toString() === req.user._id.toString();
    if (!isOwnerClient && req.user.role !== "admin") throw new HttpError(403, "Not your booking");

    if (booking.status === "accepted") await releaseSeat(booking.session._id);
    booking.status = "cancelled";
    await booking.save();
    res.json({ booking: booking.toPublic() });
  })
);

export default router;
