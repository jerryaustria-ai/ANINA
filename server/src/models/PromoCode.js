import mongoose from "mongoose";

const promoCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true, trim: true, uppercase: true },
  description: { type: String, default: "", trim: true },
  discountType: { type: String, enum: ["fixed", "percentage"], required: true },
  discountValue: { type: Number, required: true, min: 0 },
  minimumPurchaseAmount: { type: Number, default: 0, min: 0 },
  startAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  totalUsageLimit: { type: Number, default: null, min: 1 },
  usageLimitPerClient: { type: Number, default: null, min: 1 },
  usageCount: { type: Number, default: 0, min: 0 },
  applicableTo: {
    type: String,
    enum: ["all", "specific_classes", "specific_plans", "specific_packages", "regular_cash", "online_payment"],
    default: "all",
  },
  applicableClassIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "ClassDefinition" }],
  applicableTierIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "MembershipTier" }],
  applicablePaymentMethod: { type: String, enum: ["all", "cash", "online"], default: "all" },
  status: { type: String, enum: ["draft", "active", "inactive"], default: "draft", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

promoCodeSchema.pre("validate", function normalizePromoCode() {
  this.code = String(this.code || "").trim().toUpperCase();
});

promoCodeSchema.methods.effectiveStatus = function (now = new Date()) {
  if (this.status === "draft") return "draft";
  if (this.status === "inactive") return "inactive";
  if (now < this.startAt) return "scheduled";
  if (now > this.expiresAt) return "expired";
  if (this.totalUsageLimit && this.usageCount >= this.totalUsageLimit) return "usage_limit_reached";
  return "active";
};

promoCodeSchema.methods.toPublic = function () {
  return {
    id: this._id,
    code: this.code,
    description: this.description,
    discountType: this.discountType,
    discountValue: this.discountValue,
    minimumPurchaseAmount: this.minimumPurchaseAmount,
    startAt: this.startAt,
    expiresAt: this.expiresAt,
    totalUsageLimit: this.totalUsageLimit,
    usageLimitPerClient: this.usageLimitPerClient,
    usageCount: this.usageCount,
    applicableTo: this.applicableTo,
    applicableClassIds: (this.applicableClassIds || []).map((item) => item?._id || item),
    applicableTierIds: (this.applicableTierIds || []).map((item) => item?._id || item),
    applicableClasses: (this.applicableClassIds || []).map((item) =>
      item?.title ? { id: item._id, title: item.title } : { id: item }),
    applicablePlans: (this.applicableTierIds || []).map((item) =>
      item?.name ? { id: item._id, name: item.name } : { id: item }),
    applicablePaymentMethod: this.applicablePaymentMethod,
    status: this.effectiveStatus(),
    configuredStatus: this.status,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const PromoCode = mongoose.model("PromoCode", promoCodeSchema);
