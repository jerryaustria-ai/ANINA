import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipientRole: { type: String, enum: ["admin", "instructor", "client"], required: true, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    relatedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    relatedBookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
    relatedScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: "ClassSession", default: null },
    isRead: { type: Boolean, default: false, index: true },
    dedupeKey: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, isRead: 1 });

notificationSchema.methods.toPublic = function () {
  return {
    id: this._id,
    recipientId: this.recipientId,
    recipientRole: this.recipientRole,
    type: this.type,
    title: this.title,
    message: this.message,
    relatedUserId: this.relatedUserId,
    relatedBookingId: this.relatedBookingId,
    relatedScheduleId: this.relatedScheduleId,
    isRead: this.isRead,
    createdAt: this.createdAt,
  };
};

export const Notification = mongoose.model("Notification", notificationSchema);
