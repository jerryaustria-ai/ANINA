import { useEffect, useState } from "react";
import { api } from "../api.js";
import CalendarView from "../components/CalendarView.jsx";
import Modal from "../components/Modal.jsx";
import Avatar from "../components/Avatar.jsx";
import { useCalendar } from "../useCalendar.js";
import { fmtRange, toLocalInput, dateAtHour, STATUS_LABEL } from "../util.js";

const blankForm = { title: "", type: "group", room: "", startAt: "", endAt: "", capacity: 8, minToRun: 3 };

export default function InstructorDashboard() {
  const cal = useCalendar();
  const [sessions, setSessions] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState(null); // create/edit modal
  const [manage, setManage] = useState(null); // {session, bookings}

  async function load() {
    const from = cal.range.from.toISOString();
    const to = cal.range.to.toISOString();
    const { sessions } = await api(`/sessions?mine=1&from=${from}&to=${to}`);
    setSessions(sessions);
  }
  useEffect(() => { load().catch((e) => setMsg({ kind: "err", text: e.message })); }, [cal.range.from.getTime(), cal.range.to.getTime()]);
  useEffect(() => { api("/rooms").then(({ rooms }) => setRooms(rooms)).catch(() => {}); }, []);

  const events = sessions.map((s) => ({
    id: s.id, title: s.title, startAt: s.startAt, endAt: s.endAt, color: s.color,
    sub: `${s.room?.name} · ${s.acceptedCount}/${s.minToRun}→${s.capacity}`,
    badge: s.status === "confirmed" ? "✓" : s.status === "draft" ? "draft" : "",
    dim: s.status === "cancelled",
  }));

  function openCreate(slot) {
    const start = slot ? dateAtHour(slot.dateISO, slot.startHour) : new Date();
    const end = slot ? dateAtHour(slot.dateISO, slot.endHour) : new Date(Date.now() + 3600e3);
    setForm({ ...blankForm, room: rooms[0]?.id || "", startAt: toLocalInput(start), endAt: toLocalInput(end) });
  }

  async function saveForm() {
    setBusy(true); setMsg(null);
    try {
      const body = {
        title: form.title, type: form.type, room: form.room,
        startAt: new Date(form.startAt).toISOString(), endAt: new Date(form.endAt).toISOString(),
        capacity: Number(form.capacity), minToRun: Number(form.minToRun),
      };
      const { session } = await api("/sessions", { method: "POST", body });
      await api(`/sessions/${session.id}/publish`, { method: "POST" }); // publish immediately so clients can book
      setMsg({ kind: "ok", text: `Class "${session.title}" created & published.` });
      setForm(null); await load();
    } catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  async function openManage(sessionId) {
    const [{ session }, { bookings }] = await Promise.all([
      api(`/sessions/${sessionId}`), api(`/sessions/${sessionId}/bookings`),
    ]);
    setManage({ session, bookings });
  }
  async function refreshManage() {
    if (!manage) return;
    await openManage(manage.session.id);
    await load();
  }
  async function decide(bookingId, action) {
    setBusy(true); setMsg(null);
    try { await api(`/bookings/${bookingId}/${action}`, { method: "POST" }); await refreshManage(); }
    catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }
  async function sessionAction(action) {
    setBusy(true); setMsg(null);
    try { await api(`/sessions/${manage.session.id}/${action}`, { method: "POST" }); await refreshManage(); }
    catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  const s = manage?.session;
  const metMin = s && s.acceptedCount >= s.minToRun;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>My classes</h1><p>Drag on the calendar to add a class · tap a class to manage bookings.</p></div>
        <button className="btn" onClick={() => openCreate(null)}>+ New class</button>
      </div>
      {msg && <div className={"banner " + msg.kind}>{msg.text}</div>}

      <CalendarView
        cal={cal}
        events={events}
        onEventClick={(e) => openManage(e.id)}
        onSlotSelect={openCreate}
      />

      {/* Create / edit */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="New class"
        footer={<>
          <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn" onClick={saveForm} disabled={busy || !form?.title || !form?.room}>Create & publish</button>
        </>}
      >
        {form && (
          <div>
            <div className="field"><label>Title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Postpartum Recovery Flow" /></div>
            <div className="field row">
              <div><label>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="group">Group class</option><option value="private">Private (1:1)</option>
                </select></div>
              <div><label>Room</label>
                <select value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })}>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name} (max {r.maxCapacity})</option>)}
                </select></div>
            </div>
            <div className="field row">
              <div><label>Start</label><input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></div>
              <div><label>End</label><input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></div>
            </div>
            {form.type === "group" && (
              <div className="field row">
                <div><label>Capacity</label><input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
                <div><label>Min to run</label><input type="number" min="1" value={form.minToRun} onChange={(e) => setForm({ ...form, minToRun: e.target.value })} /></div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Manage */}
      <Modal
        open={!!manage}
        onClose={() => setManage(null)}
        title={s?.title}
        footer={s && <>
          <button className="btn danger" onClick={() => sessionAction("cancel")} disabled={busy}>Cancel class</button>
          {s.status !== "confirmed" &&
            <button className="btn clay" onClick={() => sessionAction("confirm")} disabled={busy || !metMin}
              title={metMin ? "" : `Need ${s.minToRun} accepted`}>Confirm class</button>}
        </>}
      >
        {s && (
          <div>
            <p className="meta-line">🗓 {fmtRange(s.startAt, s.endAt)} · 📍 {s.room?.name}</p>
            <div className="meta-line headcount">
              👥 {s.acceptedCount}/{s.minToRun} min ·
              <span className={"meter" + (metMin ? " met" : "")}><span style={{ width: `${Math.min(100, (s.acceptedCount / s.capacity) * 100)}%` }} /></span>
              {s.acceptedCount}/{s.capacity} seats
              <span className={"status-tag " + s.status}>{STATUS_LABEL[s.status]}</span>
            </div>
            {metMin && s.status !== "confirmed" && <div className="banner ok">Enough people to run — you can confirm this class.</div>}

            <h4 style={{ fontFamily: "var(--sans)", marginTop: "1rem", color: "var(--ink-mute)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Bookings</h4>
            {manage.bookings.length === 0 ? <div className="empty">No bookings yet.</div> : (
              <ul className="roster">
                {manage.bookings.map((b) => (
                  <li key={b.id}>
                    <Avatar src={b.client?.picture} name={b.client?.name} size={34} />
                    <div className="who"><div className="nm">{b.client?.name}</div><div className="em">{b.client?.email}</div></div>
                    <span className={"status-tag " + b.status}>{STATUS_LABEL[b.status] || b.status}</span>
                    {b.status === "pending" && <>
                      <button className="btn sm" onClick={() => decide(b.id, "accept")} disabled={busy}>Accept</button>
                      <button className="btn danger sm" onClick={() => decide(b.id, "decline")} disabled={busy}>Decline</button>
                    </>}
                    {b.status === "accepted" && <button className="btn ghost sm" onClick={() => decide(b.id, "waitlist")} disabled={busy}>Waitlist</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
