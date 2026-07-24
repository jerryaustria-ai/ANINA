import mongoose from "mongoose";

const sessionAuditSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    action: {
      type: String,
      enum: ["PERMANENTLY_DELETED", "SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED", "CHANGES_REQUESTED"],
      required: true,
    },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    performedByRole: { type: String, required: true },
    sessionSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    bookingSnapshots: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

export const SessionAudit = mongoose.model("SessionAudit", sessionAuditSchema);
