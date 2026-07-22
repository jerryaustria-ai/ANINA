import { ClassSession } from "../models/ClassSession.js";

// Atomically claim a seat: only bumps acceptedCount when it is still below
// capacity, in a single DB round-trip so two accepts can't oversell the last
// seat. Returns the updated session, or null when the class is already full.
export async function claimSeat(sessionId) {
  return ClassSession.findOneAndUpdate(
    { _id: sessionId, $expr: { $lt: ["$acceptedCount", "$capacity"] } },
    { $inc: { acceptedCount: 1 } },
    { new: true }
  );
}

// Release a seat (on cancel/decline of a previously accepted booking).
// Guarded so the counter never drops below zero.
export async function releaseSeat(sessionId) {
  return ClassSession.findOneAndUpdate(
    { _id: sessionId, acceptedCount: { $gt: 0 } },
    { $inc: { acceptedCount: -1 } },
    { new: true }
  );
}
