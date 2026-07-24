import { Router } from "express";
import mongoose from "mongoose";
import { ClassSession, SESSION_TYPES } from "../models/ClassSession.js";
import { Room } from "../models/Room.js";
import { Booking } from "../models/Booking.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { findRoomConflict, findInstructorConflict, findClientConflict } from "../services/conflict.js";
import { asyncHandler, HttpError } from "../utils/http.js";

const router = Router();
router.use(requireAuth);

const populate = (q) =>
  q.populate("instructor", "name email picture role").populate("room", "name color maxCapacity location");

function ownsOrAdmin(req, session) {
  return req.user.role === "admin" || session.instructor._id?.toString() === req.user._id.toString() ||
    session.instructor.toString?.() === req.user._id.toString();
}

const PAST_DATE_MESSAGE = "Schedules cannot be created for past dates. Please select today or a future date.";
const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || "Asia/Manila";

function dateKeyInTimezone(date, timeZone = APP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function validateNotPastDate(date) {
  if (dateKeyInTimezone(date) < dateKeyInTimezone(new Date())) {
    throw new HttpError(400, PAST_DATE_MESSAGE);
  }
}

// Validate + normalise a session's time/room/capacity. Shared by create & update.
async function validateSlot({ roomId, startAt, endAt, capacity, excludeId, instructorId, enforceNotPast = false }) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (isNaN(start) || isNaN(end)) throw new HttpError(400, "Invalid start/end time");
  if (end <= start) throw new HttpError(400, "End time must be after start time");
  if (enforceNotPast) validateNotPastDate(start);

  const instructor = await User.findOne({ _id: instructorId, role: "instructor", active: true });
  if (!instructor) throw new HttpError(400, "Assigned instructor was not found or is inactive");

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
    throw new HttpError(409, `${instructor.name} already has a schedule that overlaps this time`);
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
      filter.status = filter.status && filter.status !== "draft" ? filter.status : { $in: ["open", "confirmed", "rescheduled"] };
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

    await validateSlot({ roomId: room, startAt, endAt, capacity: cap, instructorId, enforceNotPast: true });

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
    const timeChanged = (b.startAt !== undefined && new Date(b.startAt).getTime() !== session.startAt.getTime()) ||
      (b.endAt !== undefined && new Date(b.endAt).getTime() !== session.endAt.getTime());
    const instructorId = req.user.role === "admin" && b.instructor ? b.instructor : session.instructor;
    const next = {
      roomId: b.room ?? session.room,
      startAt: b.startAt ?? session.startAt,
      endAt: b.endAt ?? session.endAt,
      capacity: b.capacity ?? session.capacity,
    };
    if (next.capacity < session.acceptedCount) {
      throw new HttpError(400, `Capacity can't drop below ${session.acceptedCount} already-accepted bookings`);
    }
    await validateSlot({ ...next, excludeId: session._id, instructorId, enforceNotPast: timeChanged });

    if (req.user.role === "admin" && Array.isArray(b.clientIds)) {
      const submittedIds = b.clientIds.map(String);
      const uniqueIds = [...new Set(submittedIds)];
      if (uniqueIds.length !== submittedIds.length) throw new HttpError(400, "A client cannot be assigned more than once");
      if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) throw new HttpError(400, "One or more client IDs are invalid");
      if (uniqueIds.length > Number(next.capacity)) {
        throw new HttpError(400, `Selected ${uniqueIds.length} clients, but this class has a maximum capacity of ${next.capacity}`);
      }
      const selectedClients = await User.find({ _id: { $in: uniqueIds }, role: "client", active: true });
      if (selectedClients.length !== uniqueIds.length) throw new HttpError(400, "One or more selected clients were not found or are inactive");
      for (const client of selectedClients) {
        const clash = await findClientConflict({
          clientId: client._id,
          startAt: new Date(next.startAt),
          endAt: new Date(next.endAt),
          excludeSessionId: session._id,
        });
        if (clash) throw new HttpError(409, `${client.name} already has another booking during the new schedule time`);
      }
    }

    const activeBookings = await Booking.find({
      session: session._id,
      status: { $in: ["pending", "accepted", "waitlisted"] },
    });
    for (const booking of activeBookings) {
      const clash = await findClientConflict({
        clientId: booking.client,
        startAt: new Date(next.startAt),
        endAt: new Date(next.endAt),
        excludeSessionId: session._id,
        excludeBookingId: booking._id,
      });
      if (clash) throw new HttpError(409, "A booked client already has another booking during the new time");
    }

    ["title", "notes", "color", "startAt", "endAt", "capacity", "minToRun"].forEach((k) => {
      if (b[k] !== undefined) session[k] = b[k];
    });
    if (b.room !== undefined) session.room = b.room;
    if (req.user.role === "admin" && b.instructor !== undefined) session.instructor = instructorId;
    if (timeChanged && req.user.role === "admin" && b.status !== "completed") {
      session.status = "rescheduled";
    } else if (b.status !== undefined && ["draft", "open", "confirmed", "rescheduled", "completed"].includes(b.status)) {
      session.status = b.status;
    }
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

// DELETE /api/sessions/:id — admin-only hard delete for unused schedules.
// Schedules with booking history must be cancelled so historical records remain valid.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    const bookingCount = await Booking.countDocuments({ session: session._id });
    if (bookingCount) {
      throw new HttpError(409, "This schedule has booking history and cannot be deleted. Cancel it instead.");
    }
    await session.deleteOne();
    res.json({ ok: true });
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
    session.acceptedCount = 0;
    await session.save();
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

// PUT /api/sessions/:id/clients { clientIds: [] }
// Admin replaces the active roster in one validated batch. Booking records are
// retained as cancelled when a client is removed so schedule history is preserved.
router.put(
  "/:id/clients",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const session = await ClassSession.findById(req.params.id);
    if (!session) throw new HttpError(404, "Session not found");
    if (["cancelled", "completed"].includes(session.status)) {
      throw new HttpError(400, "Clients cannot be changed on a cancelled or completed schedule");
    }

    const submitted = req.body?.clientIds;
    if (!Array.isArray(submitted)) throw new HttpError(400, "clientIds must be an array");
    if (submitted.some((id) => !mongoose.isValidObjectId(id))) throw new HttpError(400, "One or more client IDs are invalid");
    const clientIds = [...new Set(submitted.map(String))];
    if (clientIds.length !== submitted.length) throw new HttpError(400, "A client cannot be assigned more than once");
    if (clientIds.length > session.capacity) {
      throw new HttpError(400, `Selected ${clientIds.length} clients, but this class has a maximum capacity of ${session.capacity}`);
    }

    const clients = await User.find({ _id: { $in: clientIds }, role: "client", active: true });
    if (clients.length !== clientIds.length) throw new HttpError(400, "One or more selected clients were not found or are inactive");

    for (const client of clients) {
      const clash = await findClientConflict({
        clientId: client._id,
        startAt: session.startAt,
        endAt: session.endAt,
        excludeSessionId: session._id,
      });
      if (clash) {
        const conflicting = clash.session;
        const when = conflicting?.startAt ? new Date(conflicting.startAt).toLocaleString() : "the selected time";
        throw new HttpError(409, `${client.name} already has a conflicting booking for "${conflicting?.title || "another class"}" on ${when}`);
      }
    }

    const existing = await Booking.find({ session: session._id });
    const desired = new Set(clientIds);
    const existingByClient = new Map(existing.map((booking) => [booking.client.toString(), booking]));
    const operations = [];

    for (const booking of existing) {
      if (!desired.has(booking.client.toString()) && ["pending", "accepted", "waitlisted"].includes(booking.status)) {
        operations.push({ updateOne: { filter: { _id: booking._id }, update: { $set: { status: "cancelled" } } } });
      }
    }
    for (const clientId of clientIds) {
      const booking = existingByClient.get(clientId);
      if (booking) {
        if (booking.status !== "accepted") {
          operations.push({ updateOne: { filter: { _id: booking._id }, update: { $set: { status: "accepted" } } } });
        }
      } else {
        operations.push({ insertOne: { document: { session: session._id, client: clientId, status: "accepted", note: "Assigned by admin" } } });
      }
    }
    if (operations.length) await Booking.bulkWrite(operations, { ordered: true });
    session.acceptedCount = clientIds.length;
    await session.save();

    const bookings = await Booking.find({ session: session._id, status: "accepted" })
      .populate("client", "name email picture phone active")
      .sort("createdAt");
    res.json({
      bookings: bookings.map((booking) => booking.toPublic()),
      assignedCount: bookings.length,
      remainingSlots: Math.max(0, session.capacity - bookings.length),
    });
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
