import mongoose from "mongoose";

// A purchasable membership plan (e.g. "Sanctuary — ₱19,000/month"). Admin-managed.
// Maps to a Xendit fixed-amount recurring plan (interval MONTH by default).
const tierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    amount: { type: Number, required: true, min: 0 }, // in PHP (whole pesos)
    currency: { type: String, default: "PHP" },
    interval: { type: String, enum: ["DAY", "WEEK", "MONTH", "YEAR"], default: "MONTH" },
    intervalCount: { type: Number, default: 1, min: 1 },
    benefits: { type: [String], default: [] },
    classTags: { type: [String], default: [] },
    sessionCount: { type: Number, default: null, min: 1 },
    unlimitedClasses: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

tierSchema.methods.toPublic = function () {
  return {
    id: this._id,
    name: this.name,
    description: this.description,
    amount: this.amount,
    currency: this.currency,
    interval: this.interval,
    intervalCount: this.intervalCount,
    benefits: this.benefits,
    classTags: this.classTags,
    sessionCount: this.sessionCount,
    unlimitedClasses: this.unlimitedClasses,
    active: this.active,
    sortOrder: this.sortOrder,
  };
};

export const MembershipTier = mongoose.model("MembershipTier", tierSchema);
