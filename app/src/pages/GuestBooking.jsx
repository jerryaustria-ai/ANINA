import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { api, getToken } from "../api.js";
import { fmtTime } from "../util.js";
import Modal from "../components/Modal.jsx";

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
  const [duplicate, setDuplicate] = useState(null);

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

  async function createOrder(continueAnyway = false) {
    setState((value) => ({ ...value, submitting: true }));
    try {
      const result = await api("/guest-checkout/orders", {
        method: "POST",
        body: { ...form, sessionId, continueAnyway },
      });
      sessionStorage.setItem(`guest_order_${result.order.id}`, result.token);
      navigate(`/guest/checkout/${result.order.id}?token=${result.token}`);
    } catch (error) {
      if (["DUPLICATE_ACTIVE_PURCHASE", "ACTIVE_SCHEDULE_CONFLICT", "FIRST_TIMER_ONLY"].includes(error.code)) {
        setDuplicate({ ...error.details, code: error.code, message: error.message });
      }
      else toast.error(error.message);
      setState((value) => ({ ...value, submitting: false }));
    }
  }

  function submit(event) {
    event.preventDefault();
    createOrder(false);
  }

  function chooseDifferentPlan() {
    setDuplicate(null);
    document.getElementById("guest-plan-selection")?.scrollIntoView({ behavior: "smooth" });
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
          <section className="guest-panel" id="guest-plan-selection">
            <h2>2. Select one plan</h2>
            {!data.plans.length && <p>No package is currently available for this class.</p>}
            <div className="guest-plan-list">
              {data.plans.map((plan) => <label className={`guest-plan${form.tierId === plan.id ? " selected" : ""}`} key={plan.id}>
                <input type="radio" name="tier" value={plan.id} checked={form.tierId === plan.id}
                  onChange={(e) => setForm({ ...form, tierId: e.target.value })} />
                <div><strong>{plan.name}</strong><p>{plan.description}</p>
                  <span>{validity(plan)}{plan.firstTimerOnly ? " · First Timer Only" : ""}</span></div>
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
    <Modal
      open={!!duplicate}
      onClose={() => setDuplicate(null)}
      title={duplicate?.code === "ACTIVE_SCHEDULE_CONFLICT"
        ? "Schedule Conflict Detected"
        : duplicate?.code === "FIRST_TIMER_ONLY"
          ? "First-Time Client Plan"
          : "Duplicate Booking Detected"}
      footer={<>
        {duplicate?.code === "ACTIVE_SCHEDULE_CONFLICT"
          ? <button className="btn" type="button" onClick={() => navigate("/schedule")}>Choose a Different Schedule</button>
          : <button className="btn" type="button" onClick={chooseDifferentPlan}>Choose a Different Plan</button>}
        {duplicate?.code !== "FIRST_TIMER_ONLY" &&
          <button className="btn" type="button" onClick={() => navigate(getToken() ? "/dashboard" : "/login?next=/dashboard")}>View My Existing Booking</button>}
        {duplicate?.allowAdminOverride && <button className="btn primary" type="button"
          onClick={() => { setDuplicate(null); createOrder(true); }}>Continue Anyway</button>}
      </>}
    >
      <div className="status-notice warning" role="alert">
        {["ACTIVE_SCHEDULE_CONFLICT", "FIRST_TIMER_ONLY"].includes(duplicate?.code) ? "⚠ " : ""}
        {duplicate?.message || "You already have an active booking or class plan matching this selection. Please review your existing booking before purchasing another one."}
      </div>
      <dl className="duplicate-details">
        {duplicate?.className && <div><dt>Existing Class</dt><dd>{duplicate.className}</dd></div>}
        {duplicate?.startAt && <div><dt>Schedule</dt><dd>{new Date(duplicate.startAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</dd></div>}
        {duplicate?.existingPlanName && <div><dt>Existing Plan Name</dt><dd>{duplicate.existingPlanName}</dd></div>}
        {duplicate?.expirationDate && <div><dt>Expiration Date</dt><dd>{new Date(duplicate.expirationDate).toLocaleDateString("en-PH", { dateStyle: "medium" })}</dd></div>}
        {duplicate?.bookingReference && <div><dt>Booking Reference</dt><dd>{duplicate.bookingReference}</dd></div>}
      </dl>
    </Modal>
  </div>;
}
