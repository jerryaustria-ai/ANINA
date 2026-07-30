import mongoose from "mongoose";
import { vatInclusiveBreakdown } from "../utils/vat.js";

const guestPurchaseSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "ClassSession", required: true, index: true },
    tier: { type: mongoose.Schema.Types.ObjectId, ref: "MembershipTier", default: null },
    planSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    subtotal: { type: Number, required: true },
    vatAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    originalAmount: { type: Number, default: 0 },
    promoCode: { type: mongoose.Schema.Types.ObjectId, ref: "PromoCode", default: null, index: true },
    promoCodeText: { type: String, default: "" },
    promoDiscountType: { type: String, enum: ["fixed", "percentage"], default: null },
    promoDiscountValue: { type: Number, default: null },
    discountAmount: { type: Number, default: 0 },
    promoUsageRecordedAt: { type: Date, default: null, index: true },
    currency: { type: String, default: "PHP" },
    status: {
      type: String,
      enum: ["pending_payment", "payment_pending", "pending_email_confirmation", "cash_confirmation_processing",
        "pending_cash_payment", "paid", "pending_confirmation", "confirmed", "waitlisted",
        "declined", "cancelled", "expired", "failed", "refunded"],
      default: "pending_payment",
      index: true,
    },
    referenceId: { type: String, required: true, unique: true, index: true },
    accessToken: { type: String, required: true },
    xenditSessionId: { type: String, default: "", index: true },
    checkoutUrl: { type: String, default: "" },
    paymentId: { type: String, default: "" },
    paymentRequestId: { type: String, default: "", index: true },
    paymentMethod: { type: String, default: "Xendit" },
    enrollmentStatus: {
      type: String,
      enum: ["pending_email_confirmation", "confirmed", "enrolled", "cancelled", "expired"],
      default: null,
      index: true,
    },
    cashConfirmationTokenHash: { type: String, unique: true, sparse: true, index: true },
    cashConfirmationExpiresAt: { type: Date, default: null, index: true },
    cashConfirmationUsedAt: { type: Date, default: null },
    cashConfirmedAt: { type: Date, default: null },
    failureReason: { type: String, default: "" },
    receiptUrl: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    paymentReference: { type: String, default: "", trim: true },
    paymentNotes: { type: String, default: "", trim: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancellationNotes: { type: String, default: "", trim: true },
    refundedAt: { type: Date, default: null },
    refundedAmount: { type: Number, default: null },
    processingAt: { type: Date, default: null },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    membership: { type: mongoose.Schema.Types.ObjectId, ref: "Membership", default: null },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
    duplicateOverrideBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    duplicateOverrideAt: { type: Date, default: null },
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

guestPurchaseSchema.pre("validate", function normalizeCashConfirmationToken() {
  if (!String(this.cashConfirmationTokenHash || "").trim()) {
    this.cashConfirmationTokenHash = undefined;
  }
});

guestPurchaseSchema.methods.toPublic = function () {
  const session = this.session?.toPublic ? this.session.toPublic() : this.session;
  const tier = this.tier?.toPublic ? this.tier.toPublic() : this.tier;
  // Recompute the display breakdown for legacy orders that were created while
  // VAT_RATE was disabled. The amount charged remains the inclusive total.
  const vat = vatInclusiveBreakdown(this.totalAmount);
  return {
    id: this._id,
    referenceId: this.referenceId,
    fullName: this.fullName,
    email: this.email,
    phone: this.phone,
    session,
    tier,
    plan: this.planSnapshot,
    subtotal: vat.subtotal,
    vatAmount: vat.vatAmount,
    totalAmount: vat.totalAmount,
    originalAmount: this.originalAmount || this.totalAmount,
    discountAmount: this.discountAmount || 0,
    promoCode: this.promoCode,
    promoCodeText: this.promoCodeText,
    promoDiscountType: this.promoDiscountType,
    promoDiscountValue: this.promoDiscountValue,
    currency: this.currency,
    status: this.status,
    checkoutUrl: this.checkoutUrl,
    simulated: this.simulated,
    paidAt: this.paidAt,
    paidBy: this.paidBy,
    paymentReference: this.paymentReference,
    paymentNotes: this.paymentNotes,
    paymentMethod: this.paymentMethod,
    enrollmentStatus: this.enrollmentStatus,
    cashConfirmationExpiresAt: this.cashConfirmationExpiresAt,
    cashConfirmedAt: this.cashConfirmedAt,
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
