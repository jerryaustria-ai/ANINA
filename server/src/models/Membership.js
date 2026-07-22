import mongoose from "mongoose";

// pending        → plan created, awaiting the client to link a payment method
// active         → paid & running; client may book
// past_due       → a cycle failed; grace period, Xendit retrying
// cancelled      → cancelled by client/admin
// inactive       → Xendit deactivated (retries exhausted / ended)
export const MEMBERSHIP_STATUSES = ["pending", "active", "past_due", "cancelled", "inactive"];

const membershipSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tier: { type: mongoose.Schema.Types.ObjectId, ref: "MembershipTier", required: true },
    status: { type: String, enum: MEMBERSHIP_STATUSES, default: "pending", index: true },

    // Xendit linkage
    referenceId: { type: String, index: true }, // our id we send to Xendit
    xenditCustomerId: { type: String, default: "" },
    xenditPlanId: { type: String, default: "", index: true },
    checkoutUrl: { type: String, default: "" },

    currentPeriodEnd: { type: Date }, // client may book while now < this
    cycleCount: { type: Number, default: 0 },
    lastEvent: { type: String, default: "" },
    simulated: { type: Boolean, default: false }, // created in dev-simulation mode
  },
  { timestamps: true }
);

membershipSchema.methods.isActiveNow = function () {
  if (this.status !== "active") return false;
  return !this.currentPeriodEnd || this.currentPeriodEnd > new Date();
};

membershipSchema.methods.toPublic = function () {
  const tier = this.tier && this.tier.toPublic ? this.tier.toPublic() : this.tier;
  const cl = this.client && this.client.toPublic ? this.client.toPublic() : this.client;
  return {
    id: this._id,
    client: cl,
    tier,
    status: this.status,
    checkoutUrl: this.checkoutUrl,
    currentPeriodEnd: this.currentPeriodEnd,
    cycleCount: this.cycleCount,
    simulated: this.simulated,
    activeNow: this.isActiveNow(),
    createdAt: this.createdAt,
  };
};

export const Membership = mongoose.model("Membership", membershipSchema);
