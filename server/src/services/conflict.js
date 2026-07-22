import { ClassSession } from "../models/ClassSession.js";

// Two intervals overlap when: existing.start < newEnd AND existing.end > newStart.
// Cancelled sessions don't hold the room.
const BLOCKING = { $ne: "cancelled" };

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
