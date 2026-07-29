import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import CalendarView from "../components/CalendarView.jsx";
import Modal from "../components/Modal.jsx";
import Avatar from "../components/Avatar.jsx";
import { useCalendar } from "../useCalendar.js";
import { useScheduleRefresh } from "../useScheduleRefresh.js";
import { fmtRange, STATUS_LABEL } from "../util.js";
import { toast } from "react-toastify";

function localDateKey(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function unavailableReason(session) {
  if (!session) return null;
  const status = String(session.status || "").toLowerCase();
  if (status === "cancelled") return "cancelled";
  if (["completed", "finished"].includes(status) ||
      new Date(session.endAt) <= new Date() ||
      localDateKey(session.startAt) < localDateKey(new Date())) return "finished";
  return null;
}

const purchaseMoney = (amount, currency = "PHP") =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(Number(amount || 0));
const purchaseValidity = (plan) => {
  const count = plan?.intervalCount || 1;
  const unit = String(plan?.interval || "MONTH").toLowerCase();
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
};

export default function ClientDashboard() {
  const cal = useCalendar();
  const [sessions, setSessions] = useState([]);
  const [mine, setMine] = useState([]); // my bookings
  const [membership, setMembership] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reschedule, setReschedule] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const from = cal.range.from.toISOString();
    const to = cal.range.to.toISOString();
    const [{ sessions }, { bookings }, mem, purchaseHistory] = await Promise.all([
      api(`/sessions?from=${from}&to=${to}`),
      api("/bookings/mine"),
      api("/memberships/mine"),
      api("/guest-checkout/history/mine"),
    ]);
    setSessions(sessions);
    setMine(bookings);
    setMembership(mem.membership);
    setPurchases(purchaseHistory.purchases);
  }
  useEffect(() => { load().catch((e) => toast.error(e.message)); }, [cal.range.from.getTime(), cal.range.to.getTime()]);
  useScheduleRefresh(load);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("schedule");
    const session = id && sessions.find((item) => item.id === id);
    if (session) setSelected(session);
    else if (id && selected?.id !== id) {
      api(`/sessions/${id}`).then(({ session: requested }) => setSelected(requested))
        .catch((error) => toast.error(error.message));
    }
  }, [sessions, selected?.id]);
  useEffect(() => {
    const openRelated = (event) => {
      const id = event.detail?.relatedScheduleId;
      if (id) api(`/sessions/${id}`).then(({ session }) => setSelected(session)).catch((error) => toast.error(error.message));
    };
    window.addEventListener("anina:open-related", openRelated);
    return () => window.removeEventListener("anina:open-related", openRelated);
  }, []);

  const canBook = !!membership?.activeNow;

  // Map sessionId -> my booking status (active bookings only).
  const myStatus = useMemo(() => {
    const m = {};
    mine.forEach((b) => { if (b.session) m[b.session.id || b.session] = b; });
    return m;
  }, [mine]);

  const events = sessions.map((s) => {
    const b = myStatus[s.id];
    const active = b && !["cancelled", "declined"].includes(b.status);
    const unavailable = unavailableReason(s);
    return {
      id: s.id, title: s.title, startAt: s.startAt, endAt: s.endAt, color: s.color,
      sub: `${s.instructor?.name || ""} · ${s.room?.name || ""}`,
      badge: unavailable === "cancelled" ? "Cancelled" : unavailable === "finished" ? "Finished"
        : active ? "✓ " + STATUS_LABEL[b.status] : (s.seatsLeft > 0 ? `${s.seatsLeft} left` : "Full"),
      dim: !!unavailable || (!active && s.seatsLeft <= 0),
    };
  });

  const sel = selected;
  const selBooking = sel ? myStatus[sel.id] : null;
  const selActive = selBooking && !["cancelled", "declined"].includes(selBooking.status);
  const selUnavailable = unavailableReason(sel);

  async function book() {
    if (selUnavailable) {
      toast.warning("This class is no longer available for booking.");
      return;
    }
    setBusy(true);
    try {
      await api("/bookings", { method: "POST", body: { sessionId: sel.id } });
      toast.success(`Requested a spot in "${sel.title}". Your instructor will confirm.`);
      setSelected(null); await load();
    } catch (e) { e.status === 410 ? toast.warning("This class is no longer available for booking.") : toast.error(e.message); }
    finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true);
    try {
      await api(`/bookings/${selBooking.id}/cancel`, { method: "POST" });
      toast.success("Booking cancelled.");
      setSelected(null); await load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function openReschedule(booking) {
    setReschedule({ booking, schedules: [], sessionId: "", loading: true, error: "" });
    try {
      const result = await api(`/bookings/${booking.id}/reschedule-options`);
      setReschedule((current) => current?.booking.id === booking.id
        ? { ...current, schedules: result.schedules, validity: result.validity, loading: false }
        : current);
    } catch (error) {
      setReschedule((current) => current?.booking.id === booking.id
        ? { ...current, loading: false, error: error.message }
        : current);
    }
  }

  async function confirmReschedule() {
    if (!reschedule?.sessionId) return;
    setBusy(true);
    try {
      await api(`/bookings/${reschedule.booking.id}/reschedule`, {
        method: "POST",
        body: { sessionId: reschedule.sessionId },
      });
      toast.success("Booking rescheduled successfully.");
      setReschedule(null);
      setSelected(null);
      await load();
    } catch (error) {
      toast.error(error.message);
      // Refresh eligibility because capacity or availability may have changed
      // while the modal was open.
      await openReschedule(reschedule.booking);
    } finally {
      setBusy(false);
    }
  }

  const upcoming = mine
    .filter((b) => b.session && !["cancelled", "declined"].includes(b.status) && !unavailableReason(b.session))
    .sort((a, b) => new Date(a.session.startAt) - new Date(b.session.startAt));
  const history = mine
    .filter((booking) => booking.session && (
      unavailableReason(booking.session) ||
      ["cancelled", "declined", "attended", "no_show"].includes(booking.status)
    ))
    .sort((a, b) => new Date(b.session.endAt) - new Date(a.session.endAt));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Book a class</h1><p>Tap any class on the calendar to request a spot.</p></div>
      </div>
      {!canBook && (
        <div className="status-notice warning">
          You do not have an active eligible class plan.{" "}
          <Link to="/schedule">View available classes →</Link>
        </div>
      )}
      {membership?.activeNow && membership.source === "guest_checkout" && (
        <div className="status-notice success">
          <strong>{membership.tier?.name} is active.</strong>{" "}
          {membership.unlimitedClasses
            ? "Unlimited eligible classes."
            : `${membership.sessionsRemaining ?? 0} available credit${membership.sessionsRemaining === 1 ? "" : "s"} · ${membership.sessionsReserved || 0} reserved.`}
        </div>
      )}

      <CalendarView
        cal={cal}
        events={events}
        onEventClick={(e) => setSelected(sessions.find((s) => s.id === e.id))}
      />

      <h2 style={{ margin: "1.6rem 0 0.8rem", fontWeight: 300 }}>Your upcoming bookings</h2>
      {upcoming.length === 0 ? (
        <div className="empty">Nothing booked yet.</div>
      ) : (
        <div className="grid-cards">
          {upcoming.map((b) => (
            <div className="card" key={b.id}>
              <h3>{b.session.title}</h3>
              <div className="sub">{fmtRange(b.session.startAt, b.session.endAt)}</div>
              <div className="sub">{b.session.instructor?.name} · {b.session.room?.name}</div>
              <div className="sub">Payment: {b.paymentStatus === "paid" ? "Paid" : "Pending"}</div>
              <div style={{ marginTop: "0.6rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className={"status-tag " + b.status}>{STATUS_LABEL[b.status]}</span>
                <span style={{ display: "flex", gap: "0.4rem" }}>
                  <button className="btn ghost sm" onClick={() => openReschedule(b)}>Reschedule</button>
                  <button className="btn danger sm" onClick={() => api(`/bookings/${b.id}/cancel`, { method: "POST" })
                    .then(() => { toast.success("Booking cancelled."); return load(); })
                    .catch((e) => toast.error(e.message))}>Cancel</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ margin: "1.6rem 0 0.8rem", fontWeight: 300 }}>Booking history</h2>
      {history.length === 0 ? <div className="empty">No booking history yet.</div> : (
        <div className="grid-cards">
          {history.map((booking) => (
            <div className="card unavailable-card" key={booking.id}>
              <h3>{booking.session.title}</h3>
              <div className="sub">{fmtRange(booking.session.startAt, booking.session.endAt)}</div>
              <div className="sub">{booking.session.instructor?.name} · {booking.session.room?.name}</div>
              <span className={"status-tag " + (booking.session.status === "cancelled" ? "cancelled" : booking.status)}>
                {booking.session.status === "cancelled" ? "Class Cancelled" : STATUS_LABEL[booking.session.status] || STATUS_LABEL[booking.status] || booking.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ margin: "1.6rem 0 0.8rem", fontWeight: 300 }}>Purchase history</h2>
      {purchases.length === 0 ? <div className="empty">No package purchases or cash enrollments yet.</div> : (
        <div className="grid-cards">
          {purchases.map((purchase) => (
            <article className="card purchase-history-card" key={purchase.id}>
              <div className="purchase-history-head">
                <div><h3>{purchase.session?.title || "Class booking"}</h3>
                  <span>{purchase.referenceId}</span></div>
                <span className={"status-tag " + (purchase.status === "refunded" ? "declined"
                  : purchase.status === "pending_cash_payment" ? "pending" : "accepted")}>
                  {purchase.status === "refunded" ? "Refunded"
                    : purchase.status === "pending_cash_payment" ? "Pending Cash Payment" : "Paid"}
                </span>
              </div>
              <dl>
                <div><dt>Schedule</dt><dd>{purchase.session ? fmtRange(purchase.session.startAt, purchase.session.endAt) : "—"}</dd></div>
                <div><dt>Purchased plan</dt><dd>{purchase.plan?.name || "—"}</dd></div>
                <div><dt>Validity</dt><dd>{purchaseValidity(purchase.plan)}</dd></div>
                <div><dt>Amount paid</dt><dd>{purchaseMoney(purchase.totalAmount, purchase.currency)}</dd></div>
                <div><dt>Booking date</dt><dd>{new Date(purchase.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</dd></div>
                <div><dt>Payment date</dt><dd>{purchase.paidAt ? new Date(purchase.paidAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={!!sel}
        onClose={() => setSelected(null)}
        title={sel?.title}
        footer={sel && (
          selActive
            ? <><button className="btn ghost" onClick={() => openReschedule(selBooking)} disabled={busy}>Reschedule</button>
              <button className="btn danger" onClick={cancel} disabled={busy}>Cancel booking</button></>
            : selUnavailable
              ? <button className="btn" disabled>{selUnavailable === "cancelled" ? "Class Cancelled" : "Class Finished"}</button>
            : !canBook
              ? <Link className="btn clay" to={`/guest/book/${sel.id}`}>Book with Cash Payment</Link>
              : <button className="btn" onClick={book} disabled={busy || !!selUnavailable}>
                  {selUnavailable === "cancelled" ? "Class Cancelled"
                    : selUnavailable === "finished" ? "Class Finished"
                    : sel.seatsLeft <= 0 ? "Join waitlist" : "Request a spot"}
                </button>
        )}
      >
        {sel && (
          <div>
            <div className="inst-row">
              <Avatar src={sel.instructor?.picture} name={sel.instructor?.name} size={44} />
              <div>
                <div className="inst-name">{sel.instructor?.name}</div>
                <div className="inst-label">Instructor</div>
              </div>
            </div>
            <p className="meta-line">🗓 {fmtRange(sel.startAt, sel.endAt)}</p>
            <p className="meta-line">📍 {sel.room?.name} · {sel.type === "private" ? "Private session" : "Group class"}</p>
            <p className="meta-line">👥 {sel.acceptedCount}/{sel.capacity} booked · {sel.seatsLeft} spot{sel.seatsLeft === 1 ? "" : "s"} left</p>
            {selActive && <p className="meta-line">You're {STATUS_LABEL[selBooking.status].toLowerCase()} for this class.</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!reschedule} onClose={() => !busy && setReschedule(null)} title="Reschedule booking"
        footer={<><button className="btn ghost" onClick={() => setReschedule(null)} disabled={busy}>Close</button>
          <button className="btn" onClick={confirmReschedule}
            disabled={busy || reschedule?.loading || !reschedule?.sessionId}>Confirm reschedule</button></>}>
        {reschedule && <div>
          <p className="meta-line">Current class: <strong>{reschedule.booking.session?.title}</strong><br />
            {fmtRange(reschedule.booking.session?.startAt, reschedule.booking.session?.endAt)}</p>
          {reschedule.loading ? <div className="empty">Checking eligible schedules…</div>
            : reschedule.error ? <div className="status-notice error">{reschedule.error}</div>
              : reschedule.schedules.length === 0
                ? <div className="empty">No available schedules for this class are within your plan validity period.</div>
                : <div className="field"><label>Eligible replacement schedule</label>
                  <select value={reschedule.sessionId}
                    onChange={(event) => setReschedule({ ...reschedule, sessionId: event.target.value })}>
                    <option value="">Select a schedule</option>
                    {reschedule.schedules.map((session) =>
                      <option key={session.id} value={session.id}>
                        {fmtRange(session.startAt, session.endAt)} — {session.instructor?.name} — {session.seatsLeft} slot{session.seatsLeft === 1 ? "" : "s"} left
                      </option>)}
                  </select>
                </div>}
        </div>}
      </Modal>
    </div>
  );
}
