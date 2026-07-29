import nodemailer from "nodemailer";
import { GuestPurchase } from "../models/GuestPurchase.js";
import { vatInclusiveBreakdown } from "../utils/vat.js";

const FROM = process.env.EMAIL_FROM || "";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || "";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@aninawellness.com";
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || "";
const LOGO_URL = process.env.EMAIL_LOGO_URL || "";
const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Manila";
const smtpConfigured = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASSWORD && FROM);
const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    })
  : null;

const money = (amount, currency = "PHP") =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(Number(amount || 0));
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char]));
const formatDateTime = (value) => value ? new Date(value).toLocaleString("en-PH", {
  timeZone: TIMEZONE, dateStyle: "long", timeStyle: "short",
}) : "—";
const sessionsLabel = (plan) => plan.unlimitedClasses
  ? "Unlimited classes"
  : `${plan.sessionCount || 1} session${(plan.sessionCount || 1) === 1 ? "" : "s"}`;
const validityLabel = (plan) => {
  const count = plan.intervalCount || 1;
  const unit = String(plan.interval || "MONTH").toLowerCase();
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
};

function templateCopy(type, purchase, details) {
  const reason = details.reason || purchase.failureReason || "No additional reason was provided by the payment gateway.";
  const copies = {
    payment_successful: {
      subject: `Payment successful — ${purchase.referenceId}`,
      eyebrow: "Payment successful",
      title: "Your payment was received",
      message: `Thank you, ${escape(purchase.fullName)}. Your ANINA package is active and your booking has been recorded.`,
      next: purchase.status === "waitlisted"
        ? "You are currently on the waitlist. We will notify you when a spot becomes available."
        : "Please arrive 10–15 minutes before class and present this booking reference at reception.",
    },
    payment_declined: {
      subject: `Payment declined — ${purchase.referenceId}`,
      eyebrow: "Payment declined",
      title: "Your payment was declined",
      message: `The payment gateway declined this attempt. Reason: ${escape(reason)}`,
      next: "Please return to checkout and try another payment method, or contact your card issuer.",
    },
    payment_failed: {
      subject: `Payment could not be completed — ${purchase.referenceId}`,
      eyebrow: "Payment failed",
      title: "We could not complete your payment",
      message: `A processing error prevented this payment from completing. Reason: ${escape(reason)}`,
      next: "You may safely retry from the checkout page. No booking or package credits were created.",
    },
    payment_pending: {
      subject: `Payment is processing — ${purchase.referenceId}`,
      eyebrow: "Payment pending",
      title: "Your payment is still being processed",
      message: "We are waiting for the payment gateway to provide a final status.",
      next: "No action is needed right now. We will send another email when the status changes.",
    },
    booking_cancelled: {
      subject: `Booking cancelled — ${purchase.referenceId}`,
      eyebrow: "Booking cancelled",
      title: "Your booking has been cancelled",
      message: `This booking was cancelled on ${escape(formatDateTime(details.cancelledAt || purchase.cancelledAt || new Date()))}.`,
      next: "Your historical booking remains available in your account. Contact us if you need help booking another class.",
    },
    refund_processed: {
      subject: `Refund processed — ${purchase.referenceId}`,
      eyebrow: "Refund processed",
      title: "Your refund has been processed",
      message: `${escape(money(details.amount ?? purchase.refundedAmount ?? purchase.totalAmount, purchase.currency))} was submitted back to your original payment method.`,
      next: `Please allow ${escape(details.processingTime || "5–10 business days")} for the credit to appear, depending on your bank or payment provider.`,
    },
  };
  return copies[type];
}

function renderEmail(purchase, type, details = {}) {
  const copy = templateCopy(type, purchase, details);
  if (!copy) throw new Error(`Unknown email notification type: ${type}`);
  const session = purchase.session;
  const plan = purchase.planSnapshot;
  const paymentDate = purchase.paidAt || details.paymentDate;
  const receipt = details.receiptUrl || purchase.receiptUrl;
  const vat = vatInclusiveBreakdown(purchase.totalAmount);
  const rows = [
    ["Customer", purchase.fullName],
    ["Email", purchase.email],
    ["Booking reference", purchase.referenceId],
    ["Class", session?.title || "—"],
    ["Schedule", `${formatDateTime(session?.startAt)}${session?.endAt ? ` – ${new Date(session.endAt).toLocaleTimeString("en-PH", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" })}` : ""}`],
    ["Instructor", session?.instructor?.name || "—"],
    ["Location", session?.room?.location || session?.room?.name || "—"],
    ["Selected plan", plan.name],
    ["Sessions / classes", sessionsLabel(plan)],
    ["Plan validity", validityLabel(plan)],
    ...(type === "refund_processed"
      ? [["Refunded amount", money(details.amount ?? purchase.refundedAmount, purchase.currency)]]
      : [
          ["VATable sales (subtotal)", money(vat.subtotal, purchase.currency)],
          ["VAT (12%)", money(vat.vatAmount, purchase.currency)],
          ["Total amount paid", money(vat.totalAmount, purchase.currency)],
        ]),
    ...(paymentDate ? [["Payment date", formatDateTime(paymentDate)]] : []),
    ...(purchase.paymentId ? [["Payment ID", purchase.paymentId]] : []),
  ];
  const logo = LOGO_URL
    ? `<img src="${escape(LOGO_URL)}" alt="ANINA Wellness Sanctuary" width="155" style="display:block;height:auto">`
    : `<div style="font:600 24px Georgia,serif;letter-spacing:8px;color:#55493e">ANINA</div>`;
  const contact = [SUPPORT_EMAIL, SUPPORT_PHONE].filter(Boolean).map(escape).join(" · ");
  return {
    subject: copy.subject,
    html: `<!doctype html><html><body style="margin:0;background:#f5f1eb;font-family:Arial,sans-serif;color:#2d2925">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:auto;background:#fff;border:1px solid #e4ddd4;border-radius:12px;overflow:hidden">
        <tr><td style="padding:26px 32px;border-bottom:1px solid #eee7df">${logo}</td></tr>
        <tr><td style="padding:32px">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#9b674c">${copy.eyebrow}</div>
          <h1 style="margin:10px 0 14px;font:400 30px Georgia,serif">${copy.title}</h1>
          <p style="margin:0 0 24px;line-height:1.65;color:#5c554e">${copy.message}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7df;border-radius:8px">
            ${rows.map(([label, value]) => `<tr><td style="padding:10px 14px;border-bottom:1px solid #f1ece6;color:#776f67;font-size:13px">${escape(label)}</td>
              <td align="right" style="padding:10px 14px;border-bottom:1px solid #f1ece6;font-size:13px;font-weight:600">${escape(value)}</td></tr>`).join("")}
          </table>
          ${receipt ? `<p style="margin:20px 0"><a href="${escape(receipt)}" style="display:inline-block;padding:12px 18px;background:#586951;color:#fff;text-decoration:none;border-radius:6px">View receipt / invoice</a></p>` : ""}
          ${details.qrCodeBase64 ? `<div style="margin:24px 0;padding:20px;text-align:center;background:#faf7f2;border:1px solid #eee7df;border-radius:8px">
            <h2 style="margin:0 0 8px;font:400 20px Georgia,serif">Your class check-in QR code</h2>
            <p style="margin:0 0 14px;color:#5c554e;font-size:13px">Present this single-use code to your Instructor or reception at check-in.</p>
            <img src="cid:anina-booking-qr" width="220" height="220" alt="Booking check-in QR code" style="display:block;margin:auto">
          </div>` : ""}
          <h2 style="margin:26px 0 8px;font:400 20px Georgia,serif">Next steps</h2>
          <p style="margin:0;line-height:1.65;color:#5c554e">${copy.next}</p>
          <p style="margin:24px 0 0">Thank you for choosing ANINA Wellness Sanctuary.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f8f3ed;color:#736a62;font-size:12px;line-height:1.6">
          Need help? Contact ${contact || "ANINA Wellness Sanctuary support"}.<br>
          This is an automatic notification for booking ${escape(purchase.referenceId)}.
        </td></tr>
      </table></td></tr></table></body></html>`,
  };
}

async function sendEmail(purchase, type, eventKey, details) {
  if (!transporter) return { status: "skipped", id: "" };
  const content = renderEmail(purchase, type, details);
  const result = await transporter.sendMail({
    from: FROM,
    to: purchase.email,
    subject: content.subject,
    html: content.html,
    headers: {
      "X-ANINA-Event-Key": `guest-${purchase._id}-${eventKey}`.slice(0, 256),
    },
    ...(details.qrCodeBase64 ? {
      attachments: [{
        filename: `anina-check-in-${purchase.referenceId}.png`,
        content: Buffer.from(details.qrCodeBase64, "base64"),
        contentType: "image/png",
        cid: "anina-booking-qr",
      }],
    } : {}),
  });
  if (!result.accepted?.length || result.rejected?.length) {
    throw new Error(`SMTP did not accept the confirmation email${result.rejected?.length
      ? ` for ${result.rejected.join(", ")}` : ""}.`);
  }
  return { status: "sent", id: result.messageId || "" };
}

export async function sendPurchaseStatusEmailOnce(purchaseId, type, eventKey, details = {}) {
  const claimed = await GuestPurchase.findOneAndUpdate(
    { _id: purchaseId, emailEventKeys: { $ne: eventKey } },
    { $addToSet: { emailEventKeys: eventKey } },
    { new: true }
  ).populate({ path: "session", populate: [{ path: "instructor" }, { path: "room" }] }).populate("tier");
  if (!claimed) return { status: "duplicate", id: "" };
  try {
    const result = await sendEmail(claimed, type, eventKey, details);
    await GuestPurchase.updateOne({ _id: purchaseId }, {
      $set: { emailStatus: result.status, emailMessageId: result.id },
      $push: { emailEvents: { eventKey, notificationType: type, status: result.status, messageId: result.id, sentAt: new Date(), error: "" } },
    });
    return result;
  } catch (error) {
    await GuestPurchase.updateOne({ _id: purchaseId }, {
      $pull: { emailEventKeys: eventKey },
      $set: { emailStatus: "failed" },
      $push: { emailEvents: { eventKey, notificationType: type, status: "failed", messageId: "", sentAt: new Date(), error: error.message } },
    });
    throw error;
  }
}

async function sendCashEmail(purchase, { subject, heading, message, actionUrl = "", actionLabel = "" }) {
  if (!transporter) return { status: "skipped", id: "" };
  const result = await transporter.sendMail({
    from: FROM,
    to: purchase.email,
    subject,
    html: `<!doctype html><html><body style="margin:0;background:#f5f1eb;font-family:Arial,sans-serif;color:#2d2925">
      <div style="max-width:620px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e4ddd4;border-radius:12px">
        <div style="font:600 24px Georgia,serif;letter-spacing:7px;color:#55493e">ANINA</div>
        <h1 style="font:400 30px Georgia,serif">${escape(heading)}</h1>
        <p style="line-height:1.65;color:#5c554e">${escape(message)}</p>
        <p><strong>Booking reference:</strong> ${escape(purchase.referenceId)}<br>
          <strong>Plan:</strong> ${escape(purchase.planSnapshot?.name)}<br>
          <strong>Class:</strong> ${escape(purchase.session?.title || "")}<br>
          <strong>Amount:</strong> ${escape(money(purchase.totalAmount, purchase.currency))}</p>
        ${actionUrl ? `<p style="margin:26px 0"><a href="${escape(actionUrl)}" style="display:inline-block;padding:13px 20px;background:#586951;color:#fff;text-decoration:none;border-radius:6px">${escape(actionLabel)}</a></p>` : ""}
        <p style="font-size:12px;color:#776f67">Need help? Contact ${escape(SUPPORT_EMAIL)}.</p>
      </div></body></html>`,
  });
  console.info("Cash confirmation SMTP result", {
    referenceId: purchase.referenceId,
    messageId: result.messageId || "",
    accepted: result.accepted || [],
    rejected: result.rejected || [],
    response: result.response || "",
  });
  if (!result.accepted?.length || result.rejected?.length) {
    throw new Error(`SMTP did not accept the cash confirmation email${result.rejected?.length
      ? ` for ${result.rejected.join(", ")}` : ""}.`);
  }
  return { status: "sent", id: result.messageId || "" };
}

export async function sendCashEnrollmentConfirmationEmail(purchase, confirmationUrl) {
  return sendCashEmail(purchase, {
    subject: `Confirm your cash enrollment — ${purchase.referenceId}`,
    heading: "Confirm your enrollment",
    message: "You selected Cash Payment. Confirm your enrollment within 24 hours. Payment will remain pending until ANINA receives and verifies your cash payment.",
    actionUrl: confirmationUrl,
    actionLabel: "Confirm Enrollment",
  });
}

export async function sendCashEnrollmentConfirmedEmail(purchase) {
  return sendCashEmail(purchase, {
    subject: `Enrollment confirmed — ${purchase.referenceId}`,
    heading: "Your enrollment is confirmed",
    message: "Your plan enrollment was created successfully. Your payment status is Pending Cash Payment until an Admin confirms receipt of your payment.",
  });
}
