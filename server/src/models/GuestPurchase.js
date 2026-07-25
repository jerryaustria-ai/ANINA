import mongoose from "mongoose";

const guestPurchaseSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "ClassSession", required: true, index: true },
    tier: { type: mongoose.Schema.Types.ObjectId, ref: "MembershipTier", required: true },
    planSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    subtotal: { type: Number, required: true },
    vatAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    currency: { type: String, default: "PHP" },
    status: {
      type: String,
      enum: ["pending_payment", "payment_pending", "paid", "pending_confirmation", "confirmed", "waitlisted", "declined", "cancelled", "failed", "refunded"],
      default: "pending_payment",
      index: true,
    },
    referenceId: { type: String, required: true, unique: true, index: true },
    accessToken: { type: String, required: true },
    xenditSessionId: { type: String, default: "", index: true },
    checkoutUrl: { type: String, default: "" },
    paymentId: { type: String, default: "" },
    paymentRequestId: { type: String, default: "", index: true },
    failureReason: { type: String, default: "" },
    receiptUrl: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundedAmount: { type: Number, default: null },
    processingAt: { type: Date, default: null },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    membership: { type: mongoose.Schema.Types.ObjectId, ref: "Membership", default: null },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
    emailStatus: { type: String, enum: ["pending", "sent", "skipped", "failed"], default: "pending" },
    emailMessageId: { type: String, default: "" },
    emailEventKeys: { type: [String], default: [] },
    emailEvents: [{
      eventKey: String,
      notificationType: String,
      status: { type: String, enum: ["sent", "skipped", "failed"] },
      messageId: String,
      sentAt: Date,
      error: String,
    }],
    simulated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

guestPurchaseSchema.methods.toPublic = function () {
  const session = this.session?.toPublic ? this.session.toPublic() : this.session;
  const tier = this.tier?.toPublic ? this.tier.toPublic() : this.tier;
  return {
    id: this._id,
    referenceId: this.referenceId,
    fullName: this.fullName,
    email: this.email,
    phone: this.phone,
    session,
    tier,
    plan: this.planSnapshot,
    subtotal: this.subtotal,
    vatAmount: this.vatAmount,
    totalAmount: this.totalAmount,
    currency: this.currency,
    status: this.status,
    checkoutUrl: this.checkoutUrl,
    simulated: this.simulated,
    paidAt: this.paidAt,
    failureReason: this.failureReason,
    refundedAt: this.refundedAt,
    refundedAmount: this.refundedAmount,
    receiptUrl: this.receiptUrl,
    hasLinkedAccount: !!this.client,
    booking: this.booking,
    membership: this.membership,
    emailStatus: this.emailStatus,
    createdAt: this.createdAt,
  };
};

export const GuestPurchase = mongoose.model("GuestPurchase", guestPurchaseSchema);
