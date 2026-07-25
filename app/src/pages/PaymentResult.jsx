import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";

export default function PaymentResult() {
  const { orderId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || sessionStorage.getItem(`guest_order_${orderId}`) || "";
  const returnState = params.get("return") || "";
  const processingKey = `guest_processing_shown_${orderId}`;
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [checks, setChecks] = useState(0);
  const [showReturnProcessing, setShowReturnProcessing] = useState(
    returnState === "success" && sessionStorage.getItem(processingKey) !== "true"
  );

  useEffect(() => {
    if (!showReturnProcessing) return undefined;
    sessionStorage.setItem(processingKey, "true");
    const timer = setTimeout(() => setShowReturnProcessing(false), 2500);
    return () => clearTimeout(timer);
  }, [processingKey, showReturnProcessing]);

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
        if (!final && checks < 30) {
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
    if (showReturnProcessing) return "pending";
    if (["confirmed", "waitlisted"].includes(order?.status)) return "success";
    if (order?.status === "declined") return "declined";
    if (["failed", "cancelled"].includes(order?.status) || returnState === "error") return "failed";
    if (returnState === "cancelled" && checks >= 2) return "declined";
    return "pending";
  }, [order?.status, returnState, checks, showReturnProcessing]);

  if (error) return <div className="guest-state error"><p>{error}</p><Link to="/">Return to Home</Link></div>;
  if (!order) return <div className="guest-state">Loading payment result…</div>;
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
        <h1>Thank you!</h1>
        <p className="payment-result-lead">
          Thank you for choosing <strong>Anina Wellness Sanctuary</strong>. Your booking has been successfully confirmed.
        </p>
        <div className="payment-reference">Booking reference <strong>{order.referenceId}</strong></div>
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

function ContactHelp() {
  return <aside className="payment-contact">
    <strong>Need assistance? Our team is here to help.</strong>
    <p>Contact Anina Wellness Sanctuary for help with your booking or payment.</p>
    <div><a href="mailto:hello@aninasanctuary.ph">hello@aninasanctuary.ph</a>
      <a href="https://www.instagram.com/anina_wellness_sanctuary/">Instagram</a></div>
  </aside>;
}
