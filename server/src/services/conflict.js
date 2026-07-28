import { ClassSession } from "../models/ClassSession.js";
import { Booking } from "../models/Booking.js";

// Two intervals overlap when: existing.start < newEnd AND existing.end > newStart.
// Cancelled sessions don't hold the room.
const BLOCKING = { $in: [
  "draft", "open", "confirmed", "rescheduled", "pending_approval", "published",
  "changes_requested", "on_hold", "cancellation_requested",
] };

export async function findRoomConflict({ roomId, startAt, endAt, excludeId }) {
  const q = {
    room: roomId,
    status: BLOCKING,
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  };
  if (excludeId) q._id = { $ne: excludeId };
  return ClassSession.findOne(q).populate("instructor", "name").lean();
}

export async function findInstructorConflict({ instructorId, startAt, endAt, excludeId }) {
  const q = {
    instructor: instructorId,
    status: BLOCKING,
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  };
  if (excludeId) q._id = { $ne: excludeId };
  return ClassSession.findOne(q).populate("room", "name").lean();
}

export async function findClientConflict({ clientId, startAt, endAt, excludeSessionId, excludeBookingId }) {
  const sessionQuery = {
    status: BLOCKING,
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  };
  if (excludeSessionId) sessionQuery._id = { $ne: excludeSessionId };
  const overlappingSessionIds = await ClassSession.find(sessionQuery).distinct("_id");
  if (!overlappingSessionIds.length) return null;

  const bookingQuery = {
    client: clientId,
    session: { $in: overlappingSessionIds },
    status: { $in: ["pending", "accepted", "waitlisted"] },
  };
  if (excludeBookingId) bookingQuery._id = { $ne: excludeBookingId };
  return Booking.findOne(bookingQuery)
    .populate({ path: "session", populate: { path: "instructor", select: "name" } })
    .lean();
}
