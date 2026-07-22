import { Router } from "express";
import { ClassSession, SESSION_TYPES } from "../models/ClassSession.js";
import { Room } from "../models/Room.js";
import { Booking } from "../models/Booking.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { findRoomConflict, findInstructorConflict } from "../services/conflict.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);

const populate = (q) =>
  q.populate("instructor", "name email picture role").populate("room", "name color maxCapacity location");

function ownsOrAdmin(req, session) {
  return req.user.role === "admin" || session.instructor._id?.toString() === req.user._id.toString() ||
    session.instructor.toString?.() === req.user._id.toString();
}

// Validate + normalise a session's time/room/capacity. Shared by create & update.
async function validateSlot({ roomId, startAt, endAt, capacity, excludeId, instructorId }) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (isNaN(start) || isNaN(end)) throw new HttpError(400, "Invalid start/end time");
  if (end <= start) throw new HttpError(400, "End time must be after start time");

  const room = await Room.findById(roomId);
  if (!room || !room.active) throw new HttpError(400, "Room not found or inactive");
  if (capacity > room.maxCapacity) {
    throw new HttpError(400, `Capacity ${capacity} exceeds room max of ${room.maxCapacity}`);
  }

  const roomClash = await findRoomConflict({ roomId, startAt: start, endAt: end, excludeId });
  if (roomClash) {
    throw new HttpError(409, `Room "${room.name}" is already booked for that time ("${roomClash.title}")`);
  }
  const instClash = await findInstructorConflict({ instructorId, startAt: start, endAt: end, excludeId });
  if (instClash) {
    throw new HttpError(409, "You already have a class scheduled that overlaps this time");
  }
  return { room, start, end };
}

// GET /api/sessions?from=&to=&room=&instructor=&mine=1&status=&type=
// Role-aware: clients never see other people's drafts.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to, room, instructor, mine, status, type } = req.query;
    const filter = {};
    if (from || to) {
      filter.startAt = {};
      if (from) filter.startAt.$gte = new Date(from);
      if (to) filter.startAt.$lte = new Date(to);
    }
    if (room) filter.room = room;
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (instructor) filter.instructor = instructor;
    if (mine === "1") filter.instructor = req.user._id;

    // Clients only ever see published classes (open/confirmed), never drafts.
    if (req.user.role === "client") {
      filter.status = filter.status && filter.status !== "draft" ? filter.status : { $in: ["open", "confirmed"] };
    }

    const sessions = await populate(ClassSession.find(filter).sort("startAt"));
    res.json({ sessions: sessions.map((s) => s.toPublic()) });
  })
);

// POST /api/sessions — instructors create their own; admin may create for anyone.
router.post(
  "/",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const { title, type = "group", room, startAt, endAt, capacity, minToRun = 1, notes, color } = req.body || {};
    const instructorId = req.body.instructor && req.user.role === "admin" ? req.body.instructor : req.user._id;

    if (!title || !room || !startAt || !endAt || !capacity) {
      throw new HttpError(400, "title, room, startAt, endAt and capacity are required");
    }
    if (!SESSION_TYPES.includes(type)) throw new HttpError(400, "Invalid session type");
    const cap = type === "private" ? 1 : Number(capacity);
    const min = type === "private" ? 1 : Number(minToRun);
    if (min > cap) throw new HttpError(400, "minToRun cannot exceed capacity");

    await validateSlot({ roomId: room, startAt, endAt, capacity: cap, instructorId });

    const session = await ClassSession.create({
      title, type, instructor: instructorId, room,
      startAt, endAt, capacity: cap, minToRun: min,
      notes, color, status: "draft",
    });
    res.status(201).json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = await populate(ClassSession.findById(req.params.id));
    if (!session) throw new HttpError(404, "Session not found");
    res.json({ session: session.toPublic() });
  })
);

// PATCH /api/sessions/:id — owner instructor or admin. Re-checks conflicts.
router.patch(
  "/:id",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");

    const b = req.body || {};
    const next = {
      roomId: b.room ?? session.room,
      startAt: b.startAt ?? session.startAt,
      endAt: b.endAt ?? session.endAt,
      capacity: b.capacity ?? session.capacity,
    };
    if (next.capacity < session.acceptedCount) {
      throw new HttpError(400, `Capacity can't drop below ${session.acceptedCount} already-accepted bookings`);
    }
    await validateSlot({ ...next, excludeId: session._id, instructorId: session.instructor });

    ["title", "notes", "color", "startAt", "endAt", "capacity", "minToRun"].forEach((k) => {
      if (b[k] !== undefined) session[k] = b[k];
    });
    if (b.room !== undefined) session.room = b.room;
    if (b.status !== undefined && ["draft", "open"].includes(b.status)) session.status = b.status;
    await session.save();
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

// POST /api/sessions/:id/confirm — lock the class as running (needs min headcount).
router.post(
  "/:id/confirm",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    if (session.acceptedCount < session.minToRun) {
      throw new HttpError(400, `Need ${session.minToRun} accepted, have ${session.acceptedCount}`);
    }
    session.status = "confirmed";
    await session.save();
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

// POST /api/sessions/:id/cancel — cancel the class; open bookings are cancelled too.
router.post(
  "/:id/cancel",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    session.status = "cancelled";
    await session.save();
    await Booking.updateMany(
      { session: session._id, status: { $in: ["pending", "accepted", "waitlisted"] } },
      { $set: { status: "cancelled" } }
    );
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

// GET /api/sessions/:id/bookings — the roster (owner instructor or admin).
router.get(
  "/:id/bookings",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    const bookings = await Booking.find({ session: session._id })
      .populate("client", "name email picture phone")
      .sort("createdAt");
    res.json({ bookings: bookings.map((bk) => bk.toPublic()) });
  })
);

// Publish a draft (convenience): draft -> open.
router.post(
  "/:id/publish",
  requireRole("instructor", "admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (!ownsOrAdmin(req, session)) throw new HttpError(403, "Not your session");
    if (session.status === "draft") session.status = "open";
    await session.save();
    res.json({ session: (await populate(ClassSession.findById(session._id))).toPublic() });
  })
);

export default router;
