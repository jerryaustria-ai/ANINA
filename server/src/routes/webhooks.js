import { Router } from "express";
import { Membership } from "../models/Membership.js";
import { asyncHandler } from "../utils/http.js";
import { normalizeEvent, applyEvent } from "../services/membership.js";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { fulfillGuestPurchase } from "../services/guestPurchase.js";
import { Booking } from "../models/Booking.js";
import { sendPurchaseStatusEmailOnce } from "../services/email.js";

// PUBLIC (no auth) — Xendit posts subscription lifecycle events here.
// Verified with the x-callback-token header (set XENDIT_WEBHOOK_TOKEN and the
// same value in the Xendit dashboard). Configure the URL as
//   https://<your-public-host>/api/webhooks/xendit
// Locally, expose it with a tunnel (ngrok/cloudflared) or use the dev simulator.
const router = Router();

router.post(
  "/xendit",
  asyncHandler(async (req, res) => {
    const expected = process.env.XENDIT_WEBHOOK_TOKEN || "";
    if (expected && req.get("x-callback-token") !== expected) {
      return res.status(401).json({ error: "Invalid callback token" });
    }

    const body = req.body || {};
    const event = normalizeEvent(body.event || body.type || "");
    // Xendit identifies the plan by its id and/or our reference_id.
    const data = body.data?.data || body.data || body;
    const planId = data.plan_id || data.id || data.recurring_plan_id;
    const referenceId = data.reference_id;
    const rawEvent = String(body.event || body.type || "").toLowerCase();
    const findPurchase = async () => {
      const paymentSessionId = data.payment_session_id || (String(data.id || "").startsWith("ps-") ? data.id : "");
      const query = [
        ...(data.reference_id ? [{ referenceId: data.reference_id }] : []),
        ...(paymentSessionId ? [{ xenditSessionId: paymentSessionId }] : []),
        ...(data.payment_id ? [{ paymentId: data.payment_id }] : []),
        ...(data.payment_request_id ? [{ paymentRequestId: data.payment_request_id }] : []),
      ];
      return query.length ? GuestPurchase.findOne({ $or: query }) : null;
    };

    if (rawEvent === "payment_session.completed" || rawEvent === "payment_session_completed") {
      const purchase = await findPurchase();
      if (purchase) {
        if ((data.amount != null && Number(data.amount) !== Number(purchase.totalAmount)) ||
            (data.currency && data.currency !== purchase.currency)) {
          purchase.status = "failed";
          purchase.failureReason = "Payment amount or currency did not match the order.";
          await purchase.save();
          await sendPurchaseStatusEmailOnce(purchase._id, "payment_failed",
            `payment-mismatch:${data.payment_session_id || data.payment_id}`,
            { reason: purchase.failureReason }).catch((error) => console.warn("Payment email failed:", error.message));
          return res.json({ received: true, matched: true, status: purchase.status });
        }
        purchase.paymentRequestId = data.payment_request_id || purchase.paymentRequestId;
        purchase.paymentMethod = String(
          data.payment_method?.type ||
          data.payment_method_type ||
          data.channel_code ||
          data.payment_channel ||
          "Xendit"
        );
        purchase.receiptUrl = data.receipt_url || purchase.receiptUrl;
        await purchase.save();
        const fulfilled = await fulfillGuestPurchase(purchase._id, {
          paymentId: data.payment_id || data.payment_request_id || "",
        });
        return res.json({ received: true, matched: true, status: fulfilled.status });
      }
    }

    if (rawEvent === "payment_session.expired") {
      const purchase = await findPurchase();
      if (purchase && !["confirmed", "waitlisted", "refunded"].includes(purchase.status)) {
        const expiredSessionId = data.payment_session_id || purchase.xenditSessionId;
        purchase.status = "failed";
        purchase.failureReason = "The payment session expired before payment was completed.";
        purchase.xenditSessionId = "";
        purchase.checkoutUrl = "";
        await purchase.save();
        await sendPurchaseStatusEmailOnce(purchase._id, "payment_failed",
          `payment-session-expired:${expiredSessionId}`,
          { reason: purchase.failureReason }).catch((error) => console.warn("Payment email failed:", error.message));
        return res.json({ received: true, matched: true, status: purchase.status });
      }
    }

    if (["payment.failure", "payment.failed", "payment_failed"].includes(rawEvent)) {
      const purchase = await findPurchase();
      if (purchase && !["confirmed", "waitlisted", "refunded"].includes(purchase.status)) {
        const code = String(data.failure_code || data.failure_reason || "PAYMENT_FAILED");
        const declinedCodes = ["DECLINED", "USER_DID_NOT_AUTHORIZE", "USER_DECLINED_PAYMENT",
          "INSUFFICIENT_BALANCE", "INVALID_CVV", "EXPIRED_CARD", "STOLEN_CARD", "SUSPECTED_FRAUDULENT"];
        const declined = declinedCodes.some((value) => code.includes(value));
        purchase.status = declined ? "declined" : "failed";
        purchase.failureReason = code.replaceAll("_", " ").toLowerCase();
        purchase.paymentId = data.payment_id || purchase.paymentId;
        purchase.paymentRequestId = data.payment_request_id || purchase.paymentRequestId;
        await purchase.save();
        await sendPurchaseStatusEmailOnce(purchase._id, declined ? "payment_declined" : "payment_failed",
          `payment-failure:${data.payment_id || data.payment_request_id || code}`,
          { reason: purchase.failureReason }).catch((error) => console.warn("Payment email failed:", error.message));
        return res.json({ received: true, matched: true, status: purchase.status });
      }
    }

    if (["payment.pending", "payment_pending"].includes(rawEvent) || data.status === "PENDING") {
      const purchase = await findPurchase();
      if (purchase && !["confirmed", "waitlisted", "refunded"].includes(purchase.status)) {
        purchase.status = "payment_pending";
        purchase.paymentId = data.payment_id || purchase.paymentId;
        purchase.paymentRequestId = data.payment_request_id || purchase.paymentRequestId;
        await purchase.save();
        await sendPurchaseStatusEmailOnce(purchase._id, "payment_pending",
          `payment-pending:${data.payment_id || data.payment_request_id || purchase.xenditSessionId}`)
          .catch((error) => console.warn("Payment email failed:", error.message));
        return res.json({ received: true, matched: true, status: purchase.status });
      }
    }

    if (rawEvent === "refund.succeeded") {
      const purchase = await findPurchase();
      if (purchase) {
        purchase.status = "refunded";
        purchase.refundedAt = new Date(data.updated || body.created || Date.now());
        purchase.refundedAmount = Number(data.amount ?? purchase.totalAmount);
        await purchase.save();
        if (purchase.booking) await Booking.updateOne({ _id: purchase.booking }, { $set: { paymentStatus: "refunded" } });
        if (purchase.membership) {
          await Membership.updateOne(
            { _id: purchase.membership },
            { $set: { status: "inactive", sessionsRemaining: 0, lastEvent: "refund.succeeded" } }
          );
        }
        await sendPurchaseStatusEmailOnce(purchase._id, "refund_processed",
          `refund-succeeded:${data.id || data.payment_id}`,
          { amount: purchase.refundedAmount, processingTime: "5–10 business days" })
          .catch((error) => console.warn("Refund email failed:", error.message));
        return res.json({ received: true, matched: true, status: purchase.status });
      }
    }

    const membership = await Membership.findOne(
      planId ? { $or: [{ xenditPlanId: planId }, { referenceId }] } : { referenceId }
    ).populate("tier");

    // Always 200 so Xendit doesn't retry storms; log unmatched events.
    if (!membership || !event) {
      console.warn("Xendit webhook unmatched:", { event: body.event, planId, referenceId });
      return res.json({ received: true, matched: false });
    }

    // A subscription checkout begins as a ps- Payment Session. Once Xendit
    // creates the recurring plan, retain its repl_ id so later cancellation
    // deactivates the actual plan rather than the completed checkout session.
    if (data.id?.startsWith("repl_") || data.plan_id?.startsWith("repl_")) {
      membership.xenditPlanId = data.plan_id || data.id;
    }
    await applyEvent(membership, event);
    res.json({ received: true, matched: true, status: membership.status });
  })
);

export default router;
