import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import CalendarView from "../components/CalendarView.jsx";
import Modal from "../components/Modal.jsx";
import Avatar from "../components/Avatar.jsx";
import { useCalendar } from "../useCalendar.js";
import { fmtRange, STATUS_LABEL } from "../util.js";

export default function ClientDashboard() {
  const cal = useCalendar();
  const [sessions, setSessions] = useState([]);
  const [mine, setMine] = useState([]); // my bookings
  const [membership, setMembership] = useState(null);
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const from = cal.range.from.toISOString();
    const to = cal.range.to.toISOString();
    const [{ sessions }, { bookings }, mem] = await Promise.all([
      api(`/sessions?from=${from}&to=${to}`),
      api("/bookings/mine"),
      api("/memberships/mine"),
    ]);
    setSessions(sessions);
    setMine(bookings);
    setMembership(mem.membership);
  }
  useEffect(() => { load().catch((e) => setMsg({ kind: "err", text: e.message })); }, [cal.range.from.getTime(), cal.range.to.getTime()]);

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
    return {
      id: s.id, title: s.title, startAt: s.startAt, endAt: s.endAt, color: s.color,
      sub: `${s.instructor?.name || ""} · ${s.room?.name || ""}`,
      badge: active ? "✓ " + STATUS_LABEL[b.status] : (s.seatsLeft > 0 ? `${s.seatsLeft} left` : "Full"),
      dim: active ? false : s.seatsLeft <= 0,
    };
  });

  const sel = selected;
  const selBooking = sel ? myStatus[sel.id] : null;
  const selActive = selBooking && !["cancelled", "declined"].includes(selBooking.status);

  async function book() {
    setBusy(true); setMsg(null);
    try {
      await api("/bookings", { method: "POST", body: { sessionId: sel.id } });
      setMsg({ kind: "ok", text: `Requested a spot in "${sel.title}". Your instructor will confirm.` });
      setSelected(null); await load();
    } catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setMsg(null);
    try {
      await api(`/bookings/${selBooking.id}/cancel`, { method: "POST" });
      setMsg({ kind: "ok", text: "Booking cancelled." });
      setSelected(null); await load();
    } catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  const upcoming = mine
    .filter((b) => b.session && !["cancelled", "declined"].includes(b.status) && new Date(b.session.startAt) >= new Date())
    .sort((a, b) => new Date(a.session.startAt) - new Date(b.session.startAt));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Book a class</h1><p>Tap any class on the calendar to request a spot.</p></div>
      </div>
      {msg && <div className={"banner " + msg.kind}>{msg.text}</div>}
      {!canBook && (
        <div className="banner warn">
          You need an active membership to book classes. <Link to="/membership">View membership plans →</Link>
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
              <div style={{ marginTop: "0.6rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className={"status-tag " + b.status}>{STATUS_LABEL[b.status]}</span>
                <button className="btn danger sm" onClick={() => api(`/bookings/${b.id}/cancel`, { method: "POST" }).then(load)}>Cancel</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!sel}
        onClose={() => setSelected(null)}
        title={sel?.title}
        footer={sel && (
          selActive
            ? <button className="btn danger" onClick={cancel} disabled={busy}>Cancel booking</button>
            : !canBook
              ? <Link className="btn clay" to="/membership">Membership required — Subscribe</Link>
              : <button className="btn" onClick={book} disabled={busy || sel.seatsLeft <= 0}>
                  {sel.seatsLeft <= 0 ? "Class full" : "Request a spot"}
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
            {selActive && <div className="banner ok" style={{ marginTop: "0.8rem" }}>You're {STATUS_LABEL[selBooking.status].toLowerCase()} for this class.</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
