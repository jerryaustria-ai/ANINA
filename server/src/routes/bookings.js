import { Router } from "express";
import { Booking } from "../models/Booking.js";
import { ClassSession } from "../models/ClassSession.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { claimSeat, releaseSeat } from "../services/capacity.js";
import { hasActiveMembership } from "../services/membership.js";
import { findClientConflict } from "../services/conflict.js";
import { assertScheduleBookable } from "../services/scheduleTime.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);

const isOwnerInstructor = (req, session) =>
  req.user.role === "admin" || session.instructor.toString() === req.user._id.toString();

async function validateClientSlot({ clientId, session, excludeBookingId }) {
  const client = await User.findOne({ _id: clientId, role: "client", active: true });
  if (!client) throw new HttpError(400, "Selected client was not found or is inactive");
  const clash = await findClientConflict({
    clientId,
    startAt: session.startAt,
    endAt: session.endAt,
    excludeSessionId: session._id,
    excludeBookingId,
  });
  if (clash) {
    throw new HttpError(409, `${client.name} already has a booking that overlaps this time`);
  }
  return client;
}

// POST /api/bookings  { sessionId, note }  — client requests a seat (pending).
router.post(
  "/",
  requireRole("client", "admin"),
  asyncHandler(async (req, res) => {
    const { sessionId, note } = req.body || {};

    const session = await ClassSession.findById(sessionId);
    if (!session) throw new HttpError(404, "Session not found");
    assertScheduleBookable(session);

    // Gate: clients must hold an active membership to book. (Admin exempt.)
    if (req.user.role === "client" && !(await hasActiveMembership(req.user._id))) {
      throw new HttpError(402, "An active membership is required to book classes");
    }

    const clientId = req.user.role === "admin" && req.body.clientId ? req.body.clientId : req.user._id;
    await validateClientSlot({ clientId, session });
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

// Admin overview of every client booking, including its schedule.
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    const bookings = await Booking.find()
      .populate("client", "name email picture phone active")
      .populate({ path: "session", populate: [{ path: "instructor", select: "name email picture" }, { path: "room", select: "name color location" }] })
      .sort("-createdAt");
    res.json({ bookings: bookings.filter((b) => b.session).map((b) => b.toPublic()) });
  })
);

// Admin can assign a client directly. The booking is accepted and occupies a seat.
router.post(
  "/admin",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { sessionId, clientId, note = "" } = req.body || {};
    if (!sessionId || !clientId) throw new HttpError(400, "sessionId and clientId are required");
    const session = await ClassSession.findById(sessionId);
    if (!session) throw new HttpError(404, "Session not found");
    assertScheduleBookable(session);
    await validateClientSlot({ clientId, session });
    const existing = await Booking.findOne({ session: sessionId, client: clientId });
    if (existing && !["cancelled", "declined"].includes(existing.status)) {
      throw new HttpError(409, "This client is already assigned to the selected schedule");
    }

    const seat = await claimSeat(session._id);
    if (!seat) throw new HttpError(409, "This schedule is already full");
    try {
      const booking = existing || new Booking({ session: sessionId, client: clientId });
      booking.status = "accepted";
      booking.note = note;
      await booking.save();
      await booking.populate("client", "name email picture phone");
      res.status(201).json({ booking: booking.toPublic() });
    } catch (error) {
      await releaseSeat(session._id);
      throw error;
    }
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
    assertScheduleBookable(booking.session);
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

// Admin reschedules an individual booking to another available schedule.
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const booking = await Booking.findById(req.params.id).populate("session");
    if (!booking) throw new HttpError(404, "Booking not found");
    const targetId = req.body?.sessionId;
    if (!targetId) throw new HttpError(400, "sessionId is required");
    if (targetId === booking.session._id.toString()) return res.json({ booking: booking.toPublic() });

    const target = await ClassSession.findById(targetId);
    if (!target) throw new HttpError(404, "Target schedule not found");
    assertScheduleBookable(target);
    await validateClientSlot({ clientId: booking.client, session: target, excludeBookingId: booking._id });
    const duplicate = await Booking.findOne({ session: target._id, client: booking.client, _id: { $ne: booking._id } });
    if (duplicate) throw new HttpError(409, "Client already has a booking record for the target schedule");

    const wasAccepted = booking.status === "accepted";
    if (wasAccepted) {
      const seat = await claimSeat(target._id);
      if (!seat) throw new HttpError(409, "Target schedule is already full");
    }
    const oldSessionId = booking.session._id;
    try {
      booking.session = target._id;
      booking.status = wasAccepted ? "accepted" : "pending";
      if (req.body.note !== undefined) booking.note = req.body.note;
      await booking.save();
      if (wasAccepted) await releaseSeat(oldSessionId);
      const result = await Booking.findById(booking._id)
        .populate("client", "name email picture phone")
        .populate({ path: "session", populate: [{ path: "instructor", select: "name email picture" }, { path: "room", select: "name color location" }] });
      res.json({ booking: result.toPublic(), rescheduled: true });
    } catch (error) {
      if (wasAccepted) await releaseSeat(target._id);
      throw error;
    }
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
    assertScheduleBookable(booking.session);
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
