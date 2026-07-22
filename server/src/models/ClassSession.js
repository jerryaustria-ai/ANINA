import mongoose from "mongoose";

export const SESSION_TYPES = ["group", "private"];
// draft   → instructor is still setting it up (not visible to clients)
// open    → published, clients may book
// confirmed → instructor confirmed it runs (min headcount met)
// cancelled → called off
// completed → in the past / marked done
export const SESSION_STATUSES = ["draft", "open", "confirmed", "cancelled", "completed"];

const classSessionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: SESSION_TYPES, default: "group", index: true },

    instructor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true, index: true },

    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },

    // capacity must be <= room.maxCapacity (enforced in the route/service)
    capacity: { type: Number, required: true, min: 1 },
    minToRun: { type: Number, required: true, min: 1, default: 1 },

    status: { type: String, enum: SESSION_STATUSES, default: "draft", index: true },

    // Number of ACCEPTED bookings. Maintained atomically as seats fill.
    acceptedCount: { type: Number, default: 0, min: 0 },

    notes: { type: String, default: "" },
    color: { type: String, default: "" }, // falls back to room colour on the client
  },
  { timestamps: true }
);

// Fast room-overlap lookups (conflict guard queries by room + time window).
classSessionSchema.index({ room: 1, startAt: 1, endAt: 1 });

classSessionSchema.methods.toPublic = function () {
  const inst = this.instructor && this.instructor.toPublic ? this.instructor.toPublic() : this.instructor;
  const rm = this.room && this.room.toPublic ? this.room.toPublic() : this.room;
  return {
    id: this._id,
    title: this.title,
    type: this.type,
    instructor: inst,
    room: rm,
    startAt: this.startAt,
    endAt: this.endAt,
    capacity: this.capacity,
    minToRun: this.minToRun,
    status: this.status,
    acceptedCount: this.acceptedCount,
    seatsLeft: Math.max(0, this.capacity - this.acceptedCount),
    notes: this.notes,
    color: this.color || (rm && rm.color) || "",
  };
};

export const ClassSession = mongoose.model("ClassSession", classSessionSchema);
