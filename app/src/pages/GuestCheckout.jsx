import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { api } from "../api.js";
import { fmtTime } from "../util.js";

const money = (amount, currency = "PHP") =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount);

function validity(plan) {
  const unit = plan.interval?.toLowerCase() || "month";
  return `${plan.intervalCount} ${unit}${plan.intervalCount === 1 ? "" : "s"}`;
}

export default function GuestCheckout() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || sessionStorage.getItem(`guest_order_${orderId}`) || "";
  const [order, setOrder] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [promoText, setPromoText] = useState("");

  const load = () => api(`/guest-checkout/orders/${orderId}?token=${encodeURIComponent(token)}`)
    .then(({ order: value }) => {
      setOrder(value);
      setError("");
    })
    .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    if (params.get("payment") === "success") {
      toast.info("Payment received. We are confirming your booking.");
      const timer = setInterval(load, 2500);
      return () => clearInterval(timer);
    }
    if (params.get("payment") === "cancelled") toast.warning("Payment was cancelled. You can try again.");
  }, [orderId, token]);

  async function pay() {
    setWorking(true);
    try {
      const result = await api(`/guest-checkout/orders/${orderId}/payment-session`, {
        method: "POST", body: { token },
      });
      if (result.simulated) {
        const completed = await api(`/guest-checkout/orders/${orderId}/simulate-success`, {
          method: "POST", body: { token },
        });
        toast.success("Simulated payment completed and booking created.");
        navigate(`/guest/payment-result/${orderId}?token=${encodeURIComponent(token)}&return=success`);
      } else if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
      } else {
        throw new Error("The payment checkout URL is unavailable.");
      }
    } catch (err) {
      toast.error(err.message);
      sessionStorage.setItem(`guest_payment_error_${orderId}`, err.message);
      navigate(`/guest/payment-result/${orderId}?token=${encodeURIComponent(token)}&return=error`);
    } finally {
      setWorking(false);
    }
  }

  async function requestCashConfirmation() {
    setWorking(true);
    try {
      const result = await api(`/guest-checkout/orders/${orderId}/cash-confirmation`, {
        method: "POST", body: { token },
      });
      setOrder(result.order);
      toast.success("Cash booking created. Payment is pending until confirmed by an Admin.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function applyPromo() {
    if (!promoText.trim()) return toast.warning("Enter a promo code.");
    setWorking(true);
    try {
      const result = await api(`/guest-checkout/orders/${orderId}/promo-code`, {
        method: "POST", body: { token, code: promoText },
      });
      setOrder(result.order);
      setPromoText("");
      toast.success("Promo code applied successfully.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function removePromo() {
    setWorking(true);
    try {
      const result = await api(`/guest-checkout/orders/${orderId}/promo-code`, {
        method: "DELETE", body: { token },
      });
      setOrder(result.order);
      toast.info("Promo code removed.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWorking(false);
    }
  }

  if (error) return <div className="guest-state error"><p>{error}</p><Link to="/schedule">Back to schedule</Link></div>;
  if (!order) return <div className="guest-state">Loading your checkout…</div>;
  const done = ["confirmed", "waitlisted"].includes(order.status);
  const awaitingCashPayment = ["pending_email_confirmation", "pending_cash_payment"].includes(order.status);
  const plan = order.plan;
  const cashOnly = plan.directCash === true;

  return <div className="guest-flow">
    <header className="guest-flow-nav"><Link to="/"><img src="/assets/images/anina-logo.png" alt="ANINA" /></Link>
      <span>Secure checkout</span></header>
    <main className="guest-checkout-main">
      <div className="guest-flow-heading"><p>Order summary</p>
        <h1>{done ? (order.status === "confirmed" ? "Your booking is confirmed" : "You are on the waitlist") : "Review and pay"}</h1>
        {done && <span>A confirmation and receipt {order.emailStatus === "sent" ? "were sent" : "will be available"} at {order.email}.</span>}
      </div>
      <section className="guest-checkout-card">
        <div>
          <h2>{plan.name}</h2>
          <p>{order.session.title}</p>
          <p>{new Date(order.session.startAt).toLocaleDateString("en-PH", { dateStyle: "full" })}, {fmtTime(order.session.startAt)}</p>
          <dl>
            <div><dt>Validity</dt><dd>{validity(plan)}</dd></div>
            {order.discountAmount > 0 && <div><dt>Original VAT-Inclusive Amount</dt>
              <dd>{money(order.originalAmount, order.currency)}</dd></div>}
            {order.discountAmount > 0 && <div className="promo-discount-row"><dt>Promo Discount ({order.promoCodeText})</dt>
              <dd>− {money(order.discountAmount, order.currency)}</dd></div>}
            <div><dt>VATable Sales (Subtotal)</dt><dd>{money(order.subtotal, order.currency)}</dd></div>
            <div><dt>VAT (12%)</dt><dd>{money(order.vatAmount, order.currency)}</dd></div>
            <div className="checkout-total"><dt>Total Amount to Pay</dt><dd>{money(order.totalAmount, order.currency)}</dd></div>
          </dl>
        </div>
        <aside>
          <p>You will be charged a one-time payment of <strong>{money(order.totalAmount, order.currency)}</strong>, and your package will be active for <strong>{validity(plan)}</strong>.</p>
          {!done && !awaitingCashPayment && <div className="checkout-payment-readonly">
            <span>Payment Method</span>
            <strong>{cashOnly ? "Cash Payment" : "Online Payment (Xendit)"}</strong>
          </div>}
          {!done && !awaitingCashPayment && <div className="checkout-promo">
            <label>Promo Code</label>
            {order.promoCodeText ? <div className="checkout-promo-applied">
              <span><strong>{order.promoCodeText}</strong> applied</span>
              <button type="button" onClick={removePromo} disabled={working}>Remove</button>
            </div> : <div className="checkout-promo-entry">
              <input value={promoText} onChange={(event) => setPromoText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyPromo(); } }}
                placeholder="Enter promo code" autoCapitalize="characters" />
              <button type="button" onClick={applyPromo} disabled={working || !promoText.trim()}>Apply</button>
            </div>}
            <small>Only one promo code may be applied per transaction.</small>
          </div>}
          {!done && !awaitingCashPayment && <button className="guest-primary"
            onClick={cashOnly ? requestCashConfirmation : pay} disabled={working}>
            {working ? "Processing…" : cashOnly
              ? "Confirm Booking"
              : order.simulated ? "Complete Payment (Simulated)" : "Proceed to Xendit"}
          </button>}
          {awaitingCashPayment && <div className="cash-confirmation-note">
            <strong>Booking created — Pending Payment.</strong>
            <span>Please pay at ANINA before the class. Check-in remains unavailable until an Admin marks this payment as Paid.</span>
          </div>}
          {done && <Link className="guest-primary link" to="/login">Log in to view your booking</Link>}
          <small>{cashOnly
            ? "An Admin marks the booking as Paid after receiving your cash payment."
            : "Booking and package credits are created only after successful payment."}</small>
        </aside>
      </section>
    </main>
  </div>;
}
