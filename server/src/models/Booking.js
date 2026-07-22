import mongoose from "mongoose";

// pending    → client requested a seat, awaiting instructor
// accepted   → instructor approved; occupies a seat
// waitlisted → class full (or instructor waitlisted them)
// declined   → instructor declined
// cancelled  → client cancelled
// attended / no_show → post-class outcome
export const BOOKING_STATUSES = [
  "pending",
  "accepted",
  "waitlisted",
  "declined",
  "cancelled",
  "attended",
  "no_show",
];

const bookingSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "ClassSession", required: true, index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: BOOKING_STATUSES, default: "pending", index: true },
    note: { type: String, default: "" }, // client's message to the instructor
  },
  { timestamps: true }
);

// A client can hold at most one booking per session.
bookingSchema.index({ session: 1, client: 1 }, { unique: true });

bookingSchema.methods.toPublic = function () {
  const cl = this.client && this.client.toPublic ? this.client.toPublic() : this.client;
  const se = this.session && this.session.toPublic ? this.session.toPublic() : this.session;
  return {
    id: this._id,
    session: se,
    client: cl,
    status: this.status,
    note: this.note,
    createdAt: this.createdAt,
  };
};

export const Booking = mongoose.model("Booking", bookingSchema);
