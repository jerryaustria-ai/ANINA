import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { fmtTime } from "../util.js";

const money = (amount, currency = "PHP") =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(Number(amount || 0));
const validity = (plan) => {
  const count = plan?.intervalCount || 1;
  const unit = String(plan?.interval || "MONTH").toLowerCase();
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
};
const sessions = (plan) => plan?.unlimitedClasses
  ? "Unlimited classes"
  : `${plan?.sessionCount || 1} session${(plan?.sessionCount || 1) === 1 ? "" : "s"}`;

export default function PaymentResult() {
  const { orderId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = params.get("token") || sessionStorage.getItem(`guest_order_${orderId}`) || "";
  const returnState = params.get("return") || "";
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    let active = true;
    let timer;
    const load = async () => {
      try {
        const result = await api(`/guest-checkout/orders/${orderId}?token=${encodeURIComponent(token)}`);
        if (!active) return;
        setOrder(result.order);
        setError("");
        const final = ["confirmed", "waitlisted", "declined", "failed", "cancelled", "refunded"].includes(result.order.status);
        if (!final && ["success", "cancelled"].includes(returnState)) {
          timer = setTimeout(() => setChecks((value) => value + 1), 2200);
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      }
    };
    load();
    return () => { active = false; clearTimeout(timer); };
  }, [orderId, token, checks, returnState]);

  const outcome = useMemo(() => {
    if (["confirmed", "waitlisted"].includes(order?.status)) return "success";
    if (order?.status === "declined") return "declined";
    if (["failed", "cancelled"].includes(order?.status) || returnState === "error") return "failed";
    if (returnState === "cancelled" && checks >= 2) return "declined";
    return "pending";
  }, [order?.status, returnState, checks]);

  if (error) return <div className="guest-state error"><p>{error}</p><Link to="/">Return to Home</Link></div>;
  if (!order) return <div className="guest-state">Loading payment result…</div>;
  const plan = order.plan;
  const detailRows = [
    ["Booking Reference", order.referenceId],
    ["Customer Name", order.fullName],
    ["Class Name", order.session?.title],
    ["Schedule", `${new Date(order.session?.startAt).toLocaleDateString("en-PH", { dateStyle: "long" })}, ${fmtTime(order.session?.startAt)} – ${fmtTime(order.session?.endAt)}`],
    ["Purchased Plan", plan?.name],
    ["Amount Paid", money(order.totalAmount, order.currency)],
    ["Sessions / Classes", sessions(plan)],
    ["Plan Validity", validity(plan)],
    ...(order.paidAt ? [["Payment Date", new Date(order.paidAt).toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" })]] : []),
  ];
  const retry = () => navigate(`/guest/checkout/${orderId}?token=${encodeURIComponent(token)}`);
  const clientError = sessionStorage.getItem(`guest_payment_error_${orderId}`);

  return <div className="guest-flow payment-result-page">
    <header className="guest-flow-nav"><Link to="/"><img src="/assets/images/anina-logo.png" alt="ANINA Wellness Sanctuary" /></Link>
      <span>Payment result</span></header>
    <main className={`payment-result ${outcome}`}>
      {outcome === "pending" && <>
        <div className="payment-result-icon pending"><span /></div>
        <p className="payment-result-kicker">Payment processing</p>
        <h1>We’re confirming your payment.</h1>
        <p className="payment-result-lead">Please keep this page open. Your booking will appear as soon as Xendit sends the verified payment result.</p>
        <div className="payment-reference">Booking reference <strong>{order.referenceId}</strong></div>
      </>}

      {outcome === "success" && <>
        <div className="payment-result-icon success">✓</div>
        <p className="payment-result-kicker">Booking confirmed</p>
        <h1>Thank you! Your booking has been confirmed.</h1>
        <p className="payment-result-lead">Thank you for choosing Anina Wellness Sanctuary. A confirmation email containing your booking and payment details has been sent to your registered email address. We look forward to seeing you in class!</p>
        <PaymentDetails rows={detailRows} />
        <div className="payment-result-actions">
          {user?.role === "client" || order.hasLinkedAccount
            ? <Link className="guest-primary link" to={user ? "/dashboard" : "/login"}>View My Booking</Link>
            : <Link className="guest-primary link" to="/">Return to Home</Link>}
          {order.receiptUrl && <a className="payment-secondary" href={order.receiptUrl}>View Receipt</a>}
        </div>
      </>}

      {outcome === "declined" && <>
        <div className="payment-result-icon declined">!</div>
        <p className="payment-result-kicker">Payment declined</p>
        <h1>Your payment could not be completed.</h1>
        <p className="payment-result-lead">{order.failureReason || "Your payment was declined by your bank or payment provider. Please try again using another payment method or contact your bank for more information."}</p>
        <div className="payment-reference">Booking reference <strong>{order.referenceId}</strong></div>
        <div className="payment-result-actions three">
          <button className="guest-primary" onClick={retry}>Try Payment Again</button>
          {order.checkoutUrl
            ? <a className="payment-secondary" href={order.checkoutUrl}>Choose Another Payment Method</a>
            : <button className="payment-secondary" onClick={retry}>Choose Another Payment Method</button>}
          <a className="payment-secondary" href="mailto:hello@aninasanctuary.ph">Contact ANINA</a>
        </div>
        <ContactHelp />
      </>}

      {outcome === "failed" && <>
        <div className="payment-result-icon failed">×</div>
        <p className="payment-result-kicker">Payment failed</p>
        <h1>We were unable to process your payment.</h1>
        <p className="payment-result-lead">{order.failureReason || clientError || "We were unable to process your payment due to a system or network error. No charges were completed. Please try again later."}</p>
        <div className="payment-reference">Booking reference <strong>{order.referenceId}</strong></div>
        <div className="payment-result-actions three">
          <button className="guest-primary" onClick={retry}>Retry Payment</button>
          <Link className="payment-secondary" to={`/guest/book/${order.session?.id}`}>Return to Booking</Link>
          <a className="payment-secondary" href="mailto:hello@aninasanctuary.ph">Contact ANINA</a>
        </div>
        <ContactHelp />
      </>}
    </main>
  </div>;
}

function PaymentDetails({ rows }) {
  return <dl className="payment-result-details">{rows.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>;
}

function ContactHelp() {
  return <aside className="payment-contact">
    <strong>Need assistance? Our team is here to help.</strong>
    <p>Contact Anina Wellness Sanctuary for help with your booking or payment.</p>
    <div><a href="mailto:hello@aninasanctuary.ph">hello@aninasanctuary.ph</a>
      <a href="https://www.instagram.com/anina_wellness_sanctuary/">Instagram</a></div>
  </aside>;
}
