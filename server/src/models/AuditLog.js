import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorName: { type: String, required: true, index: true },
    actorRole: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    description: { type: String, required: true },
    entityType: {
      type: String,
      enum: ["user", "class", "schedule", "booking", "room", "membership", "promo_code", "cms", "system"],
      required: true,
      index: true,
    },
    entityId: { type: String, required: true, index: true },
    entityLabel: { type: String, required: true, index: true },
    previousValue: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedValue: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({
  actorName: "text",
  action: "text",
  description: "text",
  entityLabel: "text",
});

const immutable = function () {
  throw new Error("Audit trail records are immutable");
};
auditLogSchema.pre("updateOne", immutable);
auditLogSchema.pre("updateMany", immutable);
auditLogSchema.pre("findOneAndUpdate", immutable);
auditLogSchema.pre("deleteOne", immutable);
auditLogSchema.pre("deleteMany", immutable);
auditLogSchema.pre("findOneAndDelete", immutable);

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
