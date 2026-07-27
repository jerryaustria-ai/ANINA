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
    source: { type: String, enum: ["client", "admin", "guest_checkout"], default: "client" },
    paymentStatus: { type: String, enum: ["unpaid", "pending", "paid", "refunded"], default: "unpaid" },
    purchase: { type: mongoose.Schema.Types.ObjectId, ref: "GuestPurchase", default: null, index: true },
    attendanceStatus: {
      type: String,
      enum: ["pending", "present", "absent", "no_show"],
      default: "pending",
      index: true,
    },
    attendanceRecordedAt: { type: Date, default: null },
    attendanceRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    checkInTokenHash: { type: String, default: "", index: true, select: false },
    checkInTokenIssuedAt: { type: Date, default: null },
    checkInUsedAt: { type: Date, default: null },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// A client can hold at most one booking per session.
bookingSchema.index({ session: 1, client: 1 }, { unique: true });

bookingSchema.methods.toPublic = function () {
  const cl = this.client && this.client.toPublic ? this.client.toPublic() : this.client;
  const se = this.session && this.session.toPublic ? this.session.toPublic() : this.session;
  const attendanceStatus = this.status === "attended" ? "present"
    : this.status === "no_show" && (!this.attendanceStatus || this.attendanceStatus === "pending") ? "no_show"
      : this.attendanceStatus || "pending";
  const classEnded = Boolean(se?.endAt && new Date(se.endAt) <= new Date());
  const displayStatus = attendanceStatus === "present"
    ? (classEnded ? "fully_used" : "present")
    : this.status;
  return {
    id: this._id,
    session: se,
    client: cl,
    status: displayStatus,
    note: this.note,
    source: this.source,
    paymentStatus: this.paymentStatus,
    attendanceStatus,
    attendanceRecordedAt: this.attendanceRecordedAt,
    checkInUsedAt: this.checkInUsedAt,
    purchase: this.purchase,
    createdAt: this.createdAt,
  };
};

export const Booking = mongoose.model("Booking", bookingSchema);
