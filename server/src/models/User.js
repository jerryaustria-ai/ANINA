import mongoose from "mongoose";

export const ROLES = ["client", "instructor", "admin"];

const bookingHistorySchema = new mongoose.Schema(
  {
    purchase: { type: mongoose.Schema.Types.ObjectId, ref: "GuestPurchase", required: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    membership: { type: mongoose.Schema.Types.ObjectId, ref: "Membership", default: null },
    bookingReference: { type: String, required: true },
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, default: "" },
    className: { type: String, required: true },
    scheduleStart: { type: Date, required: true },
    scheduleEnd: { type: Date, required: true },
    purchasedPlan: { type: String, required: true },
    numberOfSessions: { type: Number, default: null },
    unlimitedClasses: { type: Boolean, default: false },
    validityInterval: { type: String, default: "" },
    validityIntervalCount: { type: Number, default: 1 },
    validUntil: { type: Date, default: null },
    amountPaid: { type: Number, required: true },
    currency: { type: String, default: "PHP" },
    paymentMethod: { type: String, default: "Xendit" },
    paymentStatus: { type: String, enum: ["successful"], default: "successful" },
    paymentDate: { type: Date, required: true },
    bookingDate: { type: Date, required: true },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, index: true, sparse: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: "", select: false },
    name: { type: String, required: true, trim: true },
    picture: { type: String, default: "" },
    role: { type: String, enum: ROLES, default: "client", index: true },
    phone: { type: String, default: "" },
    active: { type: Boolean, default: true },
    lastGuestPurchase: { type: mongoose.Schema.Types.ObjectId, ref: "GuestPurchase", default: null },
    purchaseCount: { type: Number, default: 0, min: 0 },
    bookingHistory: { type: [bookingHistorySchema], default: [] },

    // Instructor-only profile fields
    bio: { type: String, default: "" },
    specialties: { type: [String], default: [] },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  return {
    id: this._id,
    email: this.email,
    name: this.name,
    picture: this.picture,
    role: this.role,
    phone: this.phone,
    active: this.active,
    purchaseCount: this.purchaseCount,
    bio: this.bio,
    specialties: this.specialties,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const User = mongoose.model("User", userSchema);
