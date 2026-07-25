import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { api } from "../api.js";
import { fmtTime } from "../util.js";

const money = (amount, currency = "PHP") =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount);

function validity(plan) {
  const unit = plan.interval?.toLowerCase() || "month";
  return `Valid for ${plan.intervalCount} ${unit}${plan.intervalCount === 1 ? "" : "s"}`;
}

export default function GuestBooking() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState({ session: null, plans: [] });
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", tierId: "" });
  const [state, setState] = useState({ loading: true, submitting: false, error: "" });

  useEffect(() => {
    api(`/guest-checkout/plans?sessionId=${sessionId}`)
      .then((result) => {
        setData(result);
        setForm((value) => ({ ...value, tierId: result.plans[0]?.id || "" }));
        setState({ loading: false, submitting: false, error: "" });
      })
      .catch((error) => setState({ loading: false, submitting: false, error: error.message }));
  }, [sessionId]);

  const selectedPlan = useMemo(
    () => data.plans.find((plan) => plan.id === form.tierId),
    [data.plans, form.tierId]
  );

  async function submit(event) {
    event.preventDefault();
    setState((value) => ({ ...value, submitting: true }));
    try {
      const result = await api("/guest-checkout/orders", {
        method: "POST",
        body: { ...form, sessionId },
      });
      sessionStorage.setItem(`guest_order_${result.order.id}`, result.token);
      navigate(`/guest/checkout/${result.order.id}?token=${result.token}`);
    } catch (error) {
      toast.error(error.message);
      setState((value) => ({ ...value, submitting: false }));
    }
  }

  if (state.loading) return <div className="guest-state">Loading booking options…</div>;
  if (state.error) return <div className="guest-state error"><p>{state.error}</p><Link to="/schedule">Back to schedule</Link></div>;
  const session = data.session;

  return <div className="guest-flow">
    <header className="guest-flow-nav">
      <Link to="/"><img src="/assets/images/anina-logo.png" alt="ANINA Wellness Sanctuary" /></Link>
      <Link to="/schedule">← Back to schedule</Link>
    </header>
    <main className="guest-flow-main">
      <div className="guest-flow-heading"><p>Guest booking</p><h1>Choose your class package</h1>
        <span>No account is required. Your booking is confirmed only after successful payment.</span></div>
      <div className="guest-booking-layout">
        <form className="guest-booking-form" onSubmit={submit}>
          <section className="guest-panel">
            <h2>1. Your information</h2>
            <div className="guest-fields">
              <label>Full Name<input required minLength="2" value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
              <label>Email Address<input required type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>Phone Number<input required type="tel" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            </div>
          </section>
          <section className="guest-panel">
            <h2>2. Select one plan</h2>
            {!data.plans.length && <p>No package is currently available for this class.</p>}
            <div className="guest-plan-list">
              {data.plans.map((plan) => <label className={`guest-plan${form.tierId === plan.id ? " selected" : ""}`} key={plan.id}>
                <input type="radio" name="tier" value={plan.id} checked={form.tierId === plan.id}
                  onChange={(e) => setForm({ ...form, tierId: e.target.value })} />
                <div><strong>{plan.name}</strong><p>{plan.description}</p>
                  <span>{plan.unlimitedClasses ? "Unlimited Classes" : `${plan.sessionCount || 1} Session${(plan.sessionCount || 1) === 1 ? "" : "s"}`} · {validity(plan)}</span></div>
                <b>{money(plan.amount, plan.currency)}</b>
              </label>)}
            </div>
          </section>
          <button className="guest-primary" disabled={!selectedPlan || state.submitting}>
            {state.submitting ? "Preparing checkout…" : "Continue to Checkout"}
          </button>
        </form>
        <aside className="guest-summary">
          <p>Booking summary</p>
          <h2>{session.title}</h2>
          <dl>
            <div><dt>Schedule</dt><dd>{new Date(session.startAt).toLocaleDateString("en-PH", { dateStyle: "medium" })}<br />
              {fmtTime(session.startAt)} – {fmtTime(session.endAt)}</dd></div>
            <div><dt>Instructor</dt><dd>{session.instructor.name}</dd></div>
            <div><dt>Selected plan</dt><dd>{selectedPlan?.name || "Select a plan"}</dd></div>
            <div><dt>Validity</dt><dd>{selectedPlan ? validity(selectedPlan) : "—"}</dd></div>
          </dl>
          <div className="guest-summary-total"><span>Total</span><strong>{selectedPlan ? money(selectedPlan.amount, selectedPlan.currency) : "—"}</strong></div>
        </aside>
      </div>
    </main>
  </div>;
}
