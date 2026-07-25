import { useEffect, useState } from "react";
import { api } from "../api.js";
import CalendarView from "../components/CalendarView.jsx";
import Modal from "../components/Modal.jsx";
import Avatar from "../components/Avatar.jsx";
import { useCalendar } from "../useCalendar.js";
import { fmtRange, fmtMoney, STATUS_LABEL, toLocalInput } from "../util.js";
import { toast } from "react-toastify";
import { Link } from "react-router-dom";

export default function AdminDashboard({ view }) {
  if (view === "rooms") return <RoomsView />;
  if (view === "approvals") return <ScheduleApprovalView />;
  if (view === "audit") return <AuditTrailView />;
  if (view === "people") return <PeopleView />;
  if (view === "tiers") return <TiersView />;
  if (view === "memberships") return <MembershipsView />;
  return <ScheduleView />;
}

/* ---------- Read-only system audit trail ---------- */
const blankAuditFilters = { from: "", to: "", user: "", role: "", action: "", reference: "" };

function AuditTrailView() {
  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [filters, setFilters] = useState(blankAuditFilters);
  const [applied, setApplied] = useState(blankAuditFilters);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const query = new URLSearchParams({ page: String(page), limit: "50" });
      Object.entries(applied).forEach(([key, value]) => value && query.set(key, value));
      const data = await api(`/audit-logs?${query}`);
      setLogs(data.logs);
      setActions(data.actions);
      setPages(data.pages);
      setTotal(data.total);
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [applied, page]);

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setApplied({ ...filters });
  }

  function clearFilters() {
    setFilters(blankAuditFilters);
    setPage(1);
    setApplied(blankAuditFilters);
  }

  const labelAction = (action) => action.toLowerCase().replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const snapshot = (value) => value && Object.keys(value).length
    ? JSON.stringify(value, null, 2)
    : "Not applicable";

  return <div className="page audit-page">
    <div className="page-head"><div><h1>Audit Trail</h1>
      <p>Read-only history of important system activity. Newest activity appears first.</p></div></div>

    <form className="audit-filters" onSubmit={applyFilters}>
      <div className="field"><label>From</label><input type="date" value={filters.from}
        onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></div>
      <div className="field"><label>To</label><input type="date" value={filters.to}
        onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></div>
      <div className="field"><label>User name</label><input value={filters.user} placeholder="Search user"
        onChange={(event) => setFilters({ ...filters, user: event.target.value })} /></div>
      <div className="field"><label>User role</label><select value={filters.role}
        onChange={(event) => setFilters({ ...filters, role: event.target.value })}>
        <option value="">All roles</option><option value="admin">Admin</option>
        <option value="instructor">Instructor</option><option value="client">Client</option>
      </select></div>
      <div className="field"><label>Action type</label><select value={filters.action}
        onChange={(event) => setFilters({ ...filters, action: event.target.value })}>
        <option value="">All actions</option>{actions.map((action) =>
          <option value={action} key={action}>{labelAction(action)}</option>)}
      </select></div>
      <div className="field"><label>Schedule / booking reference</label>
        <input value={filters.reference} placeholder="Name or record ID"
          onChange={(event) => setFilters({ ...filters, reference: event.target.value })} /></div>
      <div className="audit-filter-actions">
        <button className="btn" type="submit">Apply filters</button>
        <button className="btn ghost" type="button" onClick={clearFilters}>Clear</button>
      </div>
    </form>

    <div className="audit-summary">{busy ? "Loading activity…" : `${total} audit record${total === 1 ? "" : "s"}`}</div>
    {!busy && !logs.length ? <div className="empty">No audit records match these filters.</div> :
      <div className="audit-list">{logs.map((log) => <article className="audit-entry" key={log.id}>
        <div className="audit-entry-head">
          <div><span className="status-tag">{labelAction(log.action)}</span>
            <strong>{log.entityLabel}</strong></div>
          <time>{new Date(log.createdAt).toLocaleString()}</time>
        </div>
        <p>{log.description}</p>
        <div className="audit-meta">
          <span>Performed by <strong>{log.actorName}</strong></span>
          <span className="role-badge">{log.actorRole}</span>
          <span>Affected {log.entityType}: <code>{log.entityId}</code></span>
        </div>
        {(log.previousValue || log.updatedValue) && <details className="audit-changes">
          <summary>View previous and updated values</summary>
          <div><section><h4>Previous value</h4><pre>{snapshot(log.previousValue)}</pre></section>
            <section><h4>Updated value</h4><pre>{snapshot(log.updatedValue)}</pre></section></div>
        </details>}
      </article>)}</div>}

    {pages > 1 && <div className="audit-pagination">
      <button className="btn ghost sm" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="btn ghost sm" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>Next</button>
    </div>}
  </div>;
}

function ClientMultiSelect({ clients, value, onChange, capacity }) {
  const [search, setSearch] = useState("");
  const selected = new Set(value || []);
  const filtered = clients.filter((client) =>
    `${client.name} ${client.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  const remaining = Math.max(0, Number(capacity || 0) - selected.size);

  function toggle(id) {
    if (selected.has(id)) onChange(value.filter((clientId) => clientId !== id));
    else if (selected.size < Number(capacity || 0)) onChange([...value, id]);
  }

  return <div className="client-multiselect">
    <div className="client-chips">
      {value.map((id) => {
        const client = clients.find((item) => item.id === id);
        return client ? <span className="client-chip" key={id}>{client.name}
          <button type="button" aria-label={`Remove ${client.name}`} onClick={() => toggle(id)}>×</button></span> : null;
      })}
      {!value.length && <span className="meta-line">No clients selected.</span>}
    </div>
    <div className="slot-summary"><strong>{selected.size}</strong> assigned · <strong>{remaining}</strong> remaining slot{remaining === 1 ? "" : "s"}</div>
    <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients by name or email…" />
    <div className="client-checklist">
      {filtered.map((client) => {
        const checked = selected.has(client.id);
        const disabled = !checked && selected.size >= Number(capacity || 0);
        return <label key={client.id} className={disabled ? "disabled" : ""}>
          <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(client.id)} />
          <span><strong>{client.name}</strong><small>{client.email}</small></span>
        </label>;
      })}
      {!filtered.length && <p className="meta-line">No matching clients.</p>}
    </div>
  </div>;
}

/* ---------- Studio-wide schedule ---------- */
function ScheduleView() {
  const cal = useCalendar();
  const [sessions, setSessions] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [hidden, setHidden] = useState(new Set());
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState(null);
  const [assign, setAssign] = useState(null);
  const [reschedule, setReschedule] = useState(null);
  const [scheduleReview, setScheduleReview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const from = cal.range.from.toISOString();
    const to = cal.range.to.toISOString();
    const [sessionData, bookingData] = await Promise.all([
      api(`/sessions?from=${from}&to=${to}`),
      api("/bookings"),
    ]);
    setSessions(sessionData.sessions);
    setBookings(bookingData.bookings);
    if (sel) setSel(sessionData.sessions.find((session) => session.id === sel.id) || null);
  }
  useEffect(() => { load().catch((e) => toast.error(e.message)); }, [cal.range.from.getTime(), cal.range.to.getTime()]);
  useEffect(() => {
    Promise.all([api("/rooms"), api("/users")])
      .then(([roomData, userData]) => { setRooms(roomData.rooms); setUsers(userData.users); })
      .catch((e) => toast.error(e.message));
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("schedule");
    const session = id && sessions.find((item) => item.id === id);
    if (session) setSel(session);
  }, [sessions]);
  useEffect(() => {
    const openRelated = (event) => {
      const id = event.detail?.relatedScheduleId;
      if (id) api(`/sessions/${id}`).then(({ session }) => setSel(session)).catch((error) => toast.error(error.message));
    };
    window.addEventListener("anina:open-related", openRelated);
    return () => window.removeEventListener("anina:open-related", openRelated);
  }, []);

  const clients = users.filter((user) => user.role === "client" && user.active);
  const instructors = users.filter((user) => user.role === "instructor" && user.active);
  const activeSessions = sessions.filter((session) =>
    session.status === "published" && session.isPublished && new Date(session.startAt) > new Date());
  const allSelectedBookings = sel ? bookings.filter((booking) => booking.session?.id === sel.id) : [];
  const selectedBookings = allSelectedBookings.filter((booking) =>
    ["pending", "accepted", "waitlisted"].includes(booking.status));
  const historicalBookings = allSelectedBookings.filter((booking) =>
    !["pending", "accepted", "waitlisted"].includes(booking.status));
  const serviceNames = [...new Set(sessions.map((session) => session.title).filter(Boolean))];

  const toggle = (id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function newSchedule() {
    const start = new Date();
    start.setDate(start.getDate() + 1); start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setEdit({
      title: "", type: "group", instructor: instructors[0]?.id || "", room: rooms[0]?.id || "",
      startAt: toLocalInput(start), endAt: toLocalInput(end), capacity: 1, minToRun: 1,
      notes: "", status: "published", clientIds: [],
    });
  }

  function editSchedule(session) {
    const clientIds = bookings.filter((booking) =>
      booking.session?.id === session.id && ["pending", "accepted", "waitlisted"].includes(booking.status))
      .map((booking) => booking.client?.id).filter(Boolean);
    setEdit({
      id: session.id, title: session.title, type: session.type,
      instructor: session.instructor?.id || "", room: session.room?.id || "",
      startAt: toLocalInput(session.startAt), endAt: toLocalInput(session.endAt),
      capacity: session.capacity, minToRun: session.minToRun, notes: session.notes || "",
      status: session.status, clientIds,
    });
  }

  async function saveSchedule() {
    setBusy(true);
    let createdId = null;
    try {
      const today = toLocalInput(new Date()).slice(0, 10);
      if (edit.startAt.slice(0, 10) < today) {
        throw new Error("Schedules cannot be created for past dates. Please select today or a future date.");
      }
      const body = {
        title: edit.title.trim(), type: edit.type, instructor: edit.instructor, room: edit.room,
        startAt: new Date(edit.startAt).toISOString(), endAt: new Date(edit.endAt).toISOString(),
        capacity: Number(edit.capacity), minToRun: Number(edit.minToRun), notes: edit.notes,
        status: edit.status, clientIds: edit.clientIds,
      };
      if (!body.title || !body.instructor || !body.room) throw new Error("Service, instructor, and room are required");
      if (edit.clientIds.length > body.capacity) throw new Error(`Only ${body.capacity} clients can be assigned to this class`);
      if (edit.id) {
        await api(`/sessions/${edit.id}`, { method: "PATCH", body });
        await api(`/sessions/${edit.id}/clients`, { method: "PUT", body: { clientIds: edit.clientIds } });
        toast.success(`Schedule updated with ${edit.clientIds.length} assigned client${edit.clientIds.length === 1 ? "" : "s"}.`);
      } else {
        const { session } = await api("/sessions", { method: "POST", body });
        createdId = session.id;
        await api(`/sessions/${session.id}/clients`, { method: "PUT", body: { clientIds: edit.clientIds } });
        toast.success(`Schedule created with ${edit.clientIds.length} assigned client${edit.clientIds.length === 1 ? "" : "s"}.`);
      }
      setEdit(null); await load();
    } catch (e) {
      if (createdId) {
        try { await api(`/sessions/${createdId}`, { method: "DELETE" }); } catch { /* retain it if booking writes unexpectedly succeeded */ }
      }
      if (e.status === 409) toast.warning(e.message);
      else toast.error(e.message);
    }
    finally { setBusy(false); }
  }

  async function assignClients() {
    setBusy(true);
    try {
      const result = await api(`/sessions/${assign.sessionId}/clients`, { method: "PUT", body: { clientIds: assign.clientIds } });
      setAssign(null); await load();
      toast.success(`${result.assignedCount} client assignment${result.assignedCount === 1 ? "" : "s"} saved.`);
    } catch (e) { e.status === 409 ? toast.warning(e.message) : toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function cancelBooking(booking) {
    if (!window.confirm(`Cancel ${booking.client?.name}'s booking for ${booking.session?.title}?`)) return;
    setBusy(true);
    try {
      await api(`/bookings/${booking.id}/cancel`, { method: "POST" });
      await load(); toast.success("Booking cancelled.");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function moveBooking() {
    setBusy(true);
    try {
      await api(`/bookings/${reschedule.booking.id}`, { method: "PATCH", body: { sessionId: reschedule.sessionId } });
      setReschedule(null); await load();
      toast.success("Booking rescheduled.");
    } catch (e) { e.status === 409 ? toast.warning(e.message) : toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function cancelSchedule(session) {
    if (!window.confirm(`Cancel "${session.title}"? Active client bookings will also be cancelled.`)) return;
    setBusy(true);
    try {
      await api(`/sessions/${session.id}/cancel`, { method: "POST" });
      setSel(null); await load(); toast.success("Schedule and active bookings cancelled.");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function approveSchedule(session) {
    setBusy(true);
    try {
      await api(`/sessions/${session.id}/approve`, { method: "POST" });
      setSel(null);
      await load();
      toast.success("Schedule approved and published successfully.");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function submitScheduleReview() {
    const text = scheduleReview?.text.trim();
    if (!text) {
      toast.error(scheduleReview?.action === "reject"
        ? "A rejection reason is required."
        : "Change request notes are required.");
      return;
    }
    setBusy(true);
    try {
      if (scheduleReview.action === "reject") {
        await api(`/sessions/${scheduleReview.session.id}/reject`, {
          method: "POST",
          body: { reason: text },
        });
        toast.warning("Schedule rejected.");
      } else {
        await api(`/sessions/${scheduleReview.session.id}/request-changes`, {
          method: "POST",
          body: { notes: text },
        });
        toast.info("Changes requested from the Instructor.");
      }
      setScheduleReview(null);
      setSel(null);
      await load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function deleteSchedule(session) {
    setBusy(true);
    try {
      const eligibility = await api(`/sessions/${session.id}/deletion-eligibility`);
      if (!eligibility.eligible) {
        toast.error(eligibility.wasCancelledByAssignedInstructor
          ? "This session cannot be deleted because it still has an active booking or pending spot request."
          : "The assigned Instructor must cancel this session before it can be deleted.");
        return;
      }
      if (!window.confirm("This session was cancelled by the Instructor. Are you sure you want to permanently delete it? This action cannot be undone.")) return;
      const result = await api(`/sessions/${session.id}`, { method: "DELETE" });
      setSel(null);
      await load();
      toast.success(result.message || "Session deleted successfully.");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const events = sessions
    .filter((s) => !hidden.has(s.room?.id))
    .map((s) => ({
      id: s.id, title: s.title, startAt: s.startAt, endAt: s.endAt, color: s.color,
      sub: `${s.instructor?.name} · ${s.acceptedCount}/${s.capacity}`,
      badge: s.status === "published" ? "✓" : s.status === "pending_approval" ? "Pending" : s.status === "cancelled" ? "✕" : "",
      dim: s.status === "cancelled",
    }));

  return (
    <div className="page">
      <div className="page-head"><div><h1>Studio schedule</h1><p>Manage all client and instructor schedules.</p></div>
        <button className="btn" onClick={newSchedule}>+ Create schedule</button></div>

      <div className="toolbar-row">
        <div className="chip-filter">
          {rooms.map((r) => (
            <button key={r.id} className={hidden.has(r.id) ? "" : "on"} onClick={() => toggle(r.id)}>
              <span className="swatch" style={{ background: r.color }} />{r.name}
            </button>
          ))}
        </div>
      </div>

      <CalendarView
        cal={cal}
        events={events}
        onEventClick={(e) => setSel(sessions.find((s) => s.id === e.id))}
      />

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.title}
        footer={sel && <>{sel.status === "pending_approval" ? <>
          <button className="btn danger" onClick={() => setScheduleReview({ session: sel, action: "reject", text: "" })} disabled={busy}>Reject</button>
          <button className="btn clay" onClick={() => setScheduleReview({ session: sel, action: "changes", text: "" })} disabled={busy}>Request Changes</button>
          <button className="btn" onClick={() => approveSchedule(sel)} disabled={busy}>Approve &amp; Publish</button>
        </> : <>
          <button className="btn ghost" onClick={() => editSchedule(sel)}>Edit / Reschedule</button>
          {sel.status === "cancelled" &&
            sel.cancelledByRole === "instructor" &&
            String(sel.cancelledBy) === String(sel.instructor?.id) &&
            <button className="btn danger" onClick={() => deleteSchedule(sel)} disabled={busy}>Delete Session</button>}
          {sel.status !== "cancelled" && <button className="btn danger" onClick={() => cancelSchedule(sel)} disabled={busy}>Cancel Session</button>}
        </>}</>}>
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
            <p className="meta-line">📍 {sel.room?.name}</p>
            <p className="meta-line">👥 {sel.acceptedCount}/{sel.minToRun} min · {sel.capacity} capacity</p>
            <p className="meta-line">Status: <span className={"status-tag " + sel.status}>{STATUS_LABEL[sel.status]}</span></p>
            {sel.status === "cancelled" && <p className="meta-line">
              Cancelled by: <strong>{sel.cancelledByRole === "instructor" &&
                String(sel.cancelledBy) === String(sel.instructor?.id)
                ? `${sel.instructor?.name || "Assigned Instructor"} (Instructor)`
                : sel.cancelledByRole
                  ? sel.cancelledByRole[0].toUpperCase() + sel.cancelledByRole.slice(1)
                  : "Unknown / legacy record"}</strong>
              {sel.cancelledAt ? ` · ${new Date(sel.cancelledAt).toLocaleString()}` : ""}
            </p>}
            <div className="schedule-detail-head"><h4>Client bookings</h4>
              {sel.status === "published" && sel.isPublished &&
                <button className="btn sm" onClick={() => setAssign({ sessionId: sel.id, clientIds: selectedBookings.map((booking) => booking.client?.id).filter(Boolean), capacity: sel.capacity })}>Manage clients</button>}</div>
            <p className="meta-line"><strong>{selectedBookings.length}</strong> assigned · <strong>{Math.max(0, sel.capacity - selectedBookings.length)}</strong> remaining slots</p>
            {selectedBookings.length === 0 ? <p className="meta-line">No active client bookings.</p> :
              selectedBookings.map((booking) => (
                <div className="schedule-booking" key={booking.id}>
                  <div><strong>{booking.client?.name || "Client"}</strong><span>{booking.status}{booking.paymentStatus === "paid" ? " · Paid" : ""}</span></div>
                  <div className="schedule-booking-actions">
                    {!["cancelled", "declined"].includes(booking.status) &&
                      <button className="btn ghost sm" onClick={() => setReschedule({ booking, sessionId: "" })}>Reschedule</button>}
                    {["pending", "accepted", "waitlisted"].includes(booking.status) &&
                      <button className="btn danger sm" onClick={() => cancelBooking(booking)} disabled={busy}>Cancel</button>}
                  </div>
                </div>
              ))}
            {historicalBookings.length > 0 && <>
              <h4 className="schedule-history-title">Inactive booking history</h4>
              {historicalBookings.map((booking) => (
                <div className="schedule-booking history" key={booking.id}>
                  <div><strong>{booking.client?.name || "Client"}</strong><span>{booking.status} booking record</span></div>
                </div>
              ))}
            </>}
          </div>
        )}
      </Modal>

      <Modal open={!!scheduleReview} onClose={() => setScheduleReview(null)}
        title={scheduleReview?.action === "reject" ? "Reject schedule" : "Request changes"}
        footer={<><button className="btn ghost" onClick={() => setScheduleReview(null)}>Cancel</button>
          <button className={scheduleReview?.action === "reject" ? "btn danger" : "btn"}
            onClick={submitScheduleReview}
            disabled={busy || !scheduleReview?.text.trim()}>
            {scheduleReview?.action === "reject" ? "Reject" : "Send request"}
          </button></>}>
        {scheduleReview && <div className="field">
          <label>{scheduleReview.action === "reject" ? "Rejection reason" : "Required changes"}</label>
          <textarea rows="4" value={scheduleReview.text}
            onChange={(event) => setScheduleReview({ ...scheduleReview, text: event.target.value })}
            autoFocus />
        </div>}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit or reschedule" : "Create schedule"}
        footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Close</button>
          <button className="btn" onClick={saveSchedule} disabled={busy || !edit?.title || !edit?.instructor || !edit?.room}>Save</button></>}>
        {edit && <div>
          <div className="field"><label>Available service / class name</label>
            <input list="admin-services" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Select or enter a service" />
            <datalist id="admin-services">{serviceNames.map((name) => <option value={name} key={name} />)}</datalist></div>
          <div className="field row"><div><label>Instructor</label><select value={edit.instructor} onChange={(e) => setEdit({ ...edit, instructor: e.target.value })}>
            <option value="">Select instructor</option>{instructors.map((u) => <option value={u.id} key={u.id}>{u.name}</option>)}</select></div>
            <div><label>Room</label><select value={edit.room} onChange={(e) => {
              const room = rooms.find((item) => item.id === e.target.value);
              setEdit({ ...edit, room: e.target.value, capacity: Math.min(Number(edit.capacity), room?.maxCapacity || Number(edit.capacity)) });
            }}><option value="">Select room</option>{rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}</select></div></div>
          <div className="field row"><div><label>Start</label><input type="datetime-local" min={`${toLocalInput(new Date()).slice(0, 10)}T00:00`} value={edit.startAt} onChange={(e) => setEdit({ ...edit, startAt: e.target.value })} /></div>
            <div><label>End</label><input type="datetime-local" min={`${edit.startAt?.slice(0, 10) || toLocalInput(new Date()).slice(0, 10)}T00:00`} value={edit.endAt} onChange={(e) => setEdit({ ...edit, endAt: e.target.value })} /></div></div>
          <div className="field row"><div><label>Type</label><select value={edit.type} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, type: e.target.value, capacity: e.target.value === "private" ? 1 : edit.capacity })}>
            <option value="group">Group</option><option value="private">Private</option></select></div>
            <div><label>Capacity</label><input type="number" min="1" disabled={edit.type === "private"} value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} /></div></div>
          {edit.id && <div className="field"><label>Schedule status</label><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
            <option value="published">Published</option><option value="completed">Completed</option>
          </select></div>}
          <div className="field"><label>Assigned clients</label>
            <ClientMultiSelect clients={clients} value={edit.clientIds} capacity={Number(edit.capacity)}
              onChange={(clientIds) => setEdit({ ...edit, clientIds })} /></div>
          <div className="field"><label>Notes</label><textarea rows="2" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
        </div>}
      </Modal>

      <Modal open={!!assign} onClose={() => setAssign(null)} title="Manage assigned clients"
        footer={<><button className="btn ghost" onClick={() => setAssign(null)}>Close</button>
          <button className="btn" onClick={assignClients} disabled={busy}>Save assignments</button></>}>
        {assign && <div><p className="meta-line">Removing a client removes only that assignment. The schedule and other clients remain unchanged.</p>
          <ClientMultiSelect clients={clients} value={assign.clientIds} capacity={assign.capacity}
            onChange={(clientIds) => setAssign({ ...assign, clientIds })} /></div>}
      </Modal>

      <Modal open={!!reschedule} onClose={() => setReschedule(null)} title="Reschedule booking"
        footer={<><button className="btn ghost" onClick={() => setReschedule(null)}>Close</button>
          <button className="btn" onClick={moveBooking} disabled={busy || !reschedule?.sessionId}>Confirm reschedule</button></>}>
        {reschedule && <div><p className="meta-line">Client: <strong>{reschedule.booking.client?.name}</strong><br />Current: {reschedule.booking.session?.title} — {fmtRange(reschedule.booking.session?.startAt, reschedule.booking.session?.endAt)}</p>
          <div className="field"><label>New available schedule</label><select value={reschedule.sessionId} onChange={(e) => setReschedule({ ...reschedule, sessionId: e.target.value })}>
            <option value="">Select schedule</option>{activeSessions.filter((session) => session.id !== reschedule.booking.session?.id).map((session) =>
              <option value={session.id} key={session.id}>{session.title} — {fmtRange(session.startAt, session.endAt)} — {session.instructor?.name}</option>)}</select></div></div>}
      </Modal>
    </div>
  );
}

/* ---------- Instructor schedule approvals ---------- */
function ScheduleApprovalView() {
  const [sessions, setSessions] = useState([]);
  const [detail, setDetail] = useState(null);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api("/sessions/approvals/pending").then(({ sessions }) => setSessions(sessions));
  useEffect(() => { load().catch((error) => toast.error(error.message)); }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("schedule");
    const session = id && sessions.find((item) => item.id === id);
    if (session) setDetail(session);
  }, [sessions]);

  async function approve(session) {
    setBusy(true);
    try {
      await api(`/sessions/${session.id}/approve`, { method: "POST" });
      toast.success("Schedule approved and published successfully.");
      setDetail(null); await load();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  async function submitReview() {
    const text = review.text.trim();
    if (!text) return toast.error(review.action === "reject" ? "A rejection reason is required." : "Change request notes are required.");
    setBusy(true);
    try {
      if (review.action === "reject") {
        await api(`/sessions/${review.session.id}/reject`, { method: "POST", body: { reason: text } });
        toast.warning("Schedule rejected.");
      } else {
        await api(`/sessions/${review.session.id}/request-changes`, { method: "POST", body: { notes: text } });
        toast.info("Changes requested from the Instructor.");
      }
      setReview(null); setDetail(null); await load();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  const details = (session) => <div className="approval-details">
    <p><strong>{session.title}</strong></p>
    <p className="meta-line">Instructor: {session.instructor?.name}<br />
      Date and time: {fmtRange(session.startAt, session.endAt)}<br />
      Location: {session.room?.name}{session.room?.location ? ` — ${session.room.location}` : ""}<br />
      Capacity: {session.capacity} · Minimum clients: {session.minToRun}<br />
      Type: {session.type}<br />
      Description / notes: {session.notes || "—"}<br />
      Submitted: {session.submittedAt ? new Date(session.submittedAt).toLocaleString() : "—"}<br />
      Status: {STATUS_LABEL[session.status] || session.status.replaceAll("_", " ")}</p>
  </div>;

  return <div className="page">
    <div className="page-head"><div><h1>Schedule Approval</h1><p>Review Instructor-submitted schedules before clients can see or book them.</p></div></div>
    {!sessions.length ? <div className="empty">No schedules are waiting for approval.</div> :
      <div className="grid-cards">{sessions.map((session) => <div className="card" key={session.id}>
        {details(session)}
        <div className="approval-actions">
          <button className="btn ghost sm" onClick={() => setDetail(session)}>View details</button>
          <button className="btn sm" onClick={() => approve(session)} disabled={busy}>Approve & Publish</button>
          <button className="btn danger sm" onClick={() => setReview({ session, action: "reject", text: "" })}>Reject</button>
          <button className="btn clay sm" onClick={() => setReview({ session, action: "changes", text: "" })}>Request changes</button>
        </div>
      </div>)}</div>}

    <Modal open={!!detail} onClose={() => setDetail(null)} title="Schedule details"
      footer={detail && <><button className="btn danger" onClick={() => setReview({ session: detail, action: "reject", text: "" })}>Reject</button>
        <button className="btn clay" onClick={() => setReview({ session: detail, action: "changes", text: "" })}>Request changes</button>
        <button className="btn" onClick={() => approve(detail)} disabled={busy}>Approve & Publish</button></>}>
      {detail && details(detail)}
    </Modal>

    <Modal open={!!review} onClose={() => setReview(null)}
      title={review?.action === "reject" ? "Reject schedule" : "Request changes"}
      footer={<><button className="btn ghost" onClick={() => setReview(null)}>Cancel</button>
        <button className={review?.action === "reject" ? "btn danger" : "btn"} onClick={submitReview} disabled={busy || !review?.text.trim()}>
          {review?.action === "reject" ? "Reject" : "Send request"}
        </button></>}>
      {review && <div className="field"><label>{review.action === "reject" ? "Rejection reason" : "Required changes"}</label>
        <textarea rows="4" value={review.text} onChange={(event) => setReview({ ...review, text: event.target.value })} autoFocus /></div>}
    </Modal>
  </div>;
}

/* ---------- Rooms & capacity ---------- */
const blankRoom = { name: "", maxCapacity: 10, location: "", color: "#8a9a5b", active: true };
function RoomsView() {
  const [rooms, setRooms] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api("/rooms?all=1").then(({ rooms }) => setRooms(rooms));
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true);
    try {
      const body = { name: edit.name, maxCapacity: Number(edit.maxCapacity), location: edit.location, color: edit.color, active: edit.active };
      if (edit.id) await api(`/rooms/${edit.id}`, { method: "PATCH", body });
      else await api("/rooms", { method: "POST", body });
      const wasEdit = !!edit.id;
      setEdit(null); await load(); toast.success(wasEdit ? "Room updated." : "Room created.");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head"><div><h1>Rooms</h1><p>Set each room's max capacity — classes can't exceed it.</p></div>
        <button className="btn" onClick={() => setEdit({ ...blankRoom })}>+ Add room</button></div>

      <div className="grid-cards">
        {rooms.map((r) => (
          <div className="card" key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="swatch" style={{ background: r.color, width: 14, height: 14 }} />
              <h3 style={{ flex: 1 }}>{r.name}</h3>
            </div>
            <div className="sub">Max capacity: <b>{r.maxCapacity}</b></div>
            <div className="sub">{r.location || "—"}{!r.active && " · inactive"}</div>
            <button className="btn ghost sm" style={{ marginTop: "0.7rem" }} onClick={() => setEdit(r)}>Edit</button>
          </div>
        ))}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit room" : "Add room"}
        footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy || !edit?.name}>Save</button></>}>
        {edit && (
          <div>
            <div className="field"><label>Name</label><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="field row">
              <div><label>Max capacity</label><input type="number" min="1" value={edit.maxCapacity} onChange={(e) => setEdit({ ...edit, maxCapacity: e.target.value })} /></div>
              <div><label>Colour</label><input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></div>
            </div>
            <div className="field"><label>Location</label><input value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value })} /></div>
            {edit.id && <label style={{ fontSize: "0.9rem" }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------- People & roles ---------- */
const blankUser = { name: "", email: "", phone: "", password: "", role: "client", picture: "" };

function resizeProfilePicture(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Choose an image file"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not open the image"));
      image.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const crop = Math.min(image.width, image.height);
        const sx = (image.width - crop) / 2;
        const sy = (image.height - crop) / 2;
        ctx.drawImage(image, sx, sy, crop, crop, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function PeopleView() {
  const [users, setUsers] = useState([]);
  const [add, setAdd] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [deleteReview, setDeleteReview] = useState(null);
  const [dependencyDetail, setDependencyDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api("/users").then(({ users }) => setUsers(users));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("user");
    const user = id && users.find((item) => item.id === id);
    if (user) setEditUser({ ...user, password: "", specialtiesText: (user.specialties || []).join(", ") });
  }, [users]);
  useEffect(() => {
    const openRelated = (event) => {
      const id = event.detail?.relatedUserId;
      if (id) api(`/users/${id}`).then(({ user }) =>
        setEditUser({ ...user, password: "", specialtiesText: (user.specialties || []).join(", ") })
      ).catch((error) => toast.error(error.message));
    };
    window.addEventListener("anina:open-related", openRelated);
    return () => window.removeEventListener("anina:open-related", openRelated);
  }, []);

  async function setRole(id, role) {
    try { await api(`/users/${id}/role`, { method: "PATCH", body: { role } }); await load(); toast.success("User role updated."); }
    catch (e) { toast.error(e.message); }
  }

  async function setActive(u, active) {
    try { await api(`/users/${u.id}/active`, { method: "PATCH", body: { active } }); await load();
      active ? toast.success(`${u.name} reactivated.`) : toast.info(`${u.name} was deactivated.`); }
    catch (e) { toast.error(e.message); }
  }

  async function removeUser(u) {
    try {
      const dependencies = await api(`/users/${u.id}/dependencies`);
      if (dependencies.hasDependencies) {
        setDependencyDetail(null);
        setDeleteReview(dependencies);
        return;
      }
      if (!window.confirm(`Permanently delete ${u.name} (${u.email})? This cannot be undone.`)) return;
      await api(`/users/${u.id}`, { method: "DELETE" });
      await load();
      toast.success(`${u.name} permanently deleted.`);
    }
    catch (e) { e.status === 409 ? toast.warning(e.message) : toast.error(e.message); }
  }

  async function refreshDeleteReview() {
    const dependencies = await api(`/users/${deleteReview.user.id}/dependencies`);
    setDeleteReview(dependencies);
    return dependencies;
  }

  async function cancelDependencyBooking(booking) {
    if (!window.confirm(`Cancel ${booking.client?.name || "this client's"} booking for ${booking.session?.title}?`)) return;
    setBusy(true);
    try {
      await api(`/bookings/${booking.id}/cancel`, { method: "POST" });
      await refreshDeleteReview();
      setDependencyDetail(null);
      toast.success("Booking cancelled. Historical records were retained.");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function deactivateReviewedUser() {
    const user = deleteReview.user;
    if (!window.confirm(`Deactivate ${user.name}? They will no longer be able to log in. Existing classes and bookings will be retained.`)) return;
    setBusy(true);
    try {
      await api(`/users/${user.id}/active`, { method: "PATCH", body: { active: false } });
      setDeleteReview(null); setDependencyDetail(null);
      await load();
      toast.info(`${user.name} was deactivated. All historical records were retained.`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function createUser() {
    setBusy(true);
    try {
      const { user } = await api("/users", { method: "POST", body: add });
      setAdd(null); await load();
      toast.success(`Added ${user.name} (${user.role}).`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function updateUser() {
    setBusy(true);
    try {
      const body = { ...editUser };
      if (!body.password) delete body.password;
      body.specialties = String(body.specialtiesText || "").split(",").map((item) => item.trim()).filter(Boolean);
      delete body.specialtiesText;
      const { user } = await api(`/users/${editUser.id}`, { method: "PATCH", body });
      setEditUser(null); await load();
      toast.success(`Updated ${user.name}.`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>People</h1><p>Add users, promote clients to instructors, or manage admins.</p></div>
        <button className="btn" onClick={() => setAdd({ ...blankUser })}>+ Add user</button>
      </div>
      <ul className="roster">
        {users.map((u) => (
          <li key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
            <Avatar src={u.picture} name={u.name} size={34} />
            <div className="who">
              <div className="nm">{u.name} {!u.active && <span className="status-tag cancelled">inactive</span>}</div>
              <div className="em">{u.email}</div>
            </div>
            <span className={"role-pill " + u.role}>{u.role}</span>
            <button className="btn ghost sm" onClick={() => setEditUser({ ...u, password: "", specialtiesText: (u.specialties || []).join(", ") })}>View / Edit</button>
            <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)}
              style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--line)" }}>
              <option value="client">client</option>
              <option value="instructor">instructor</option>
              <option value="admin">admin</option>
            </select>
            {u.active
              ? <button className="btn ghost sm" onClick={() => setActive(u, false)}>Deactivate</button>
              : <button className="btn ghost sm" onClick={() => setActive(u, true)}>Reactivate</button>}
            <button className="btn danger sm" onClick={() => removeUser(u)}>Delete</button>
          </li>
        ))}
      </ul>

      <Modal open={!!add} onClose={() => setAdd(null)} title="Add user"
        footer={<><button className="btn ghost" onClick={() => setAdd(null)}>Cancel</button>
          <button className="btn" onClick={createUser} disabled={busy || !add?.email || add.password.length < 8}>Add user</button></>}>
        {add && (
          <div>
            <div className="field"><label>Name</label>
              <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="Full name (optional)" /></div>
            <div className="field"><label>Email</label>
              <input type="email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} placeholder="name@example.com" /></div>
            <div className="field"><label>Phone</label>
              <input type="tel" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} placeholder="Optional phone number" /></div>
            <div className="field"><label>Initial password</label>
              <input type="password" minLength="8" autoComplete="new-password" value={add.password}
                onChange={(e) => setAdd({ ...add, password: e.target.value })} placeholder="At least 8 characters" /></div>
            <div className="field"><label>Profile picture</label>
              <div className="picture-picker">
                <Avatar src={add.picture} name={add.name} size={56} />
                <div>
                  <label className="btn ghost sm picture-button">{add.picture ? "Change picture" : "Choose picture"}
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try { setAdd({ ...add, picture: await resizeProfilePicture(file) }); }
                      catch (error) { toast.error(error.message); }
                    }} />
                  </label>
                  {add.picture && <button type="button" className="picture-remove" onClick={() => setAdd({ ...add, picture: "" })}>Remove</button>}
                </div>
              </div>
            </div>
            <div className="field"><label>Role</label>
              <select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>
                <option value="client">Client</option>
                <option value="instructor">Instructor</option>
                <option value="admin">Admin</option>
              </select></div>
            <p className="meta-line">They can use the password above or Google with the same email. Google keeps the role you set.</p>
          </div>
        )}
      </Modal>

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="User details"
        footer={<><button className="btn ghost" onClick={() => setEditUser(null)}>Cancel</button>
          <button className="btn" onClick={updateUser} disabled={busy || !editUser?.name || !editUser?.email}>Save changes</button></>}>
        {editUser && (
          <div>
            <div className="picture-picker" style={{ marginBottom: "1rem" }}>
              <Avatar src={editUser.picture} name={editUser.name} size={72} />
              <div>
                <label className="btn ghost sm picture-button">Change picture
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try { setEditUser({ ...editUser, picture: await resizeProfilePicture(file) }); }
                    catch (error) { toast.error(error.message); }
                  }} />
                </label>
                {editUser.picture && <button type="button" className="picture-remove" onClick={() => setEditUser({ ...editUser, picture: "" })}>Remove</button>}
              </div>
            </div>
            <div className="field"><label>Name</label>
              <input value={editUser.name} onChange={(e) => setEditUser({ ...editUser, name: e.target.value })} /></div>
            <div className="field"><label>Email</label>
              <input type="email" value={editUser.email} onChange={(e) => setEditUser({ ...editUser, email: e.target.value })} /></div>
            <div className="field"><label>Phone</label>
              <input type="tel" value={editUser.phone || ""} onChange={(e) => setEditUser({ ...editUser, phone: e.target.value })} placeholder="Optional" /></div>
            <div className="field"><label>Role</label>
              <select value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}>
                <option value="client">Client</option><option value="instructor">Instructor</option><option value="admin">Admin</option>
              </select></div>
            <div className="field"><label>Status</label>
              <select value={editUser.active ? "active" : "inactive"} onChange={(e) => setEditUser({ ...editUser, active: e.target.value === "active" })}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </select></div>
            <div className="field"><label>New password</label>
              <input type="password" minLength="8" autoComplete="new-password" value={editUser.password}
                onChange={(e) => setEditUser({ ...editUser, password: e.target.value })} placeholder="Leave blank to keep current password" /></div>
            <div className="field"><label>Bio</label>
              <textarea rows="3" value={editUser.bio || ""} onChange={(e) => setEditUser({ ...editUser, bio: e.target.value })} placeholder="Optional profile bio" /></div>
            <div className="field"><label>Specialties</label>
              <input value={editUser.specialtiesText || ""} onChange={(e) => setEditUser({ ...editUser, specialtiesText: e.target.value })} placeholder="Mobility, Strength, Recovery" /></div>
            <p className="meta-line">Created {editUser.createdAt ? new Date(editUser.createdAt).toLocaleString() : "—"}<br />
              Last updated {editUser.updatedAt ? new Date(editUser.updatedAt).toLocaleString() : "—"}</p>
          </div>
        )}
      </Modal>

      <Modal open={!!deleteReview} onClose={() => { setDeleteReview(null); setDependencyDetail(null); }} title="User cannot be deleted"
        footer={<><button className="btn ghost" onClick={() => { setDeleteReview(null); setDependencyDetail(null); }}>Close</button>
          <button className="btn danger" onClick={deactivateReviewedUser} disabled={busy || !deleteReview?.user?.active}>Deactivate User</button></>}>
        {deleteReview && (
          <div>
            <div className="status-notice warning">This user has existing classes or bookings and cannot be deleted. Please deactivate the user instead.</div>
            <div className="dependency-user">
              <Avatar src={deleteReview.user.picture} name={deleteReview.user.name} size={42} />
              <div><strong>{deleteReview.user.name}</strong><div className="meta-line">{deleteReview.user.email} · {deleteReview.user.role}</div></div>
            </div>

            {deleteReview.sessions.length > 0 && <h4 className="dependency-heading">Assigned classes and schedules</h4>}
            {deleteReview.sessions.map((session) => (
              <div className="dependency-row" key={session.id}>
                <div className="dependency-main"><strong>{session.title}</strong>
                  <span>{new Date(session.startAt).toLocaleDateString()} · {new Date(session.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–{new Date(session.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  <span>Instructor: {session.instructor?.name || "—"} · Clients: {session.bookings?.map((b) => b.client?.name).filter(Boolean).join(", ") || "None"}</span>
                  <span>Status: {session.status}</span></div>
                <button className="btn ghost sm" onClick={() => setDependencyDetail({ type: "class", data: session })}>View details</button>
              </div>
            ))}

            {deleteReview.bookings.length > 0 && <h4 className="dependency-heading">Client bookings</h4>}
            {deleteReview.bookings.map((booking) => (
              <div className="dependency-row" key={booking.id}>
                <div className="dependency-main"><strong>{booking.session?.title || "Booking"}</strong>
                  <span>{new Date(booking.session?.startAt).toLocaleDateString()} · {new Date(booking.session?.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–{new Date(booking.session?.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  <span>Instructor: {booking.session?.instructor?.name || "—"} · Client: {booking.client?.name || deleteReview.user.name}</span>
                  <span>Booking status: {booking.status}</span></div>
                <div className="dependency-actions"><button className="btn ghost sm" onClick={() => setDependencyDetail({ type: "booking", data: booking })}>View details</button>
                  {["pending", "accepted", "waitlisted"].includes(booking.status) && <button className="btn danger sm" onClick={() => cancelDependencyBooking(booking)} disabled={busy}>Cancel booking</button>}</div>
              </div>
            ))}

            {dependencyDetail && (
              <div className="dependency-detail">
                <div className="dependency-detail-head"><h4>{dependencyDetail.type === "class" ? "Class details" : "Booking details"}</h4>
                  <button className="modal-x" onClick={() => setDependencyDetail(null)}>×</button></div>
                {dependencyDetail.type === "class" ? (
                  <>
                    <p><strong>{dependencyDetail.data.title}</strong></p>
                    <p className="meta-line">Room: {dependencyDetail.data.room?.name || "—"}<br />Instructor: {dependencyDetail.data.instructor?.name || "—"}<br />Capacity: {dependencyDetail.data.acceptedCount}/{dependencyDetail.data.capacity}<br />Status: {dependencyDetail.data.status}</p>
                    <h4>Class bookings</h4>
                    {dependencyDetail.data.bookings?.length ? dependencyDetail.data.bookings.map((booking) => (
                      <div className="detail-booking" key={booking.id}><span>{booking.client?.name || "Client"} · {booking.status}</span>
                        {["pending", "accepted", "waitlisted"].includes(booking.status) && <button className="btn danger sm" onClick={() => cancelDependencyBooking(booking)} disabled={busy}>Cancel</button>}</div>
                    )) : <p className="meta-line">No bookings for this class.</p>}
                  </>
                ) : (
                  <p className="meta-line"><strong>{dependencyDetail.data.session?.title}</strong><br />Client: {dependencyDetail.data.client?.name || deleteReview.user.name}<br />Instructor: {dependencyDetail.data.session?.instructor?.name || "—"}<br />Room: {dependencyDetail.data.session?.room?.name || "—"}<br />Status: {dependencyDetail.data.status}<br />Note: {dependencyDetail.data.note || "—"}</p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------- Membership tiers (admin-managed) ---------- */
const blankTier = { name: "", description: "", amount: 15000, currency: "PHP", interval: "MONTH", intervalCount: 1,
  benefits: "", classTags: "", sessionCount: 10, unlimitedClasses: false, active: true, sortOrder: 0 };
function TiersView() {
  const [tiers, setTiers] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api("/tiers?all=1").then(({ tiers }) => setTiers(tiers));
  useEffect(() => { load(); }, []);

  function openEdit(t) {
    setEdit(t ? { ...t, benefits: (t.benefits || []).join("\n"), classTags: (t.classTags || []).join(", ") } : { ...blankTier });
  }
  async function save() {
    setBusy(true);
    try {
      const body = { ...edit, amount: Number(edit.amount), intervalCount: Number(edit.intervalCount),
        sessionCount: edit.unlimitedClasses ? null : Number(edit.sessionCount || 1),
        benefits: String(edit.benefits || "").split("\n").map((s) => s.trim()).filter(Boolean),
        classTags: String(edit.classTags || "").split(",").map((s) => s.trim()).filter(Boolean) };
      if (edit.id) await api(`/tiers/${edit.id}`, { method: "PATCH", body });
      else await api("/tiers", { method: "POST", body });
      const wasEdit = !!edit.id;
      setEdit(null); await load(); toast.success(wasEdit ? "Class plan updated." : "Class plan created.");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Membership / Class Plans</h1><p>Plans available for one-time purchase, recurring billing, or both purchase flows.</p></div>
        <button className="btn" onClick={() => openEdit(null)}>+ Add plan</button>
      </div>

      {tiers.length === 0 ? <div className="empty">No class plans yet.</div> : (
        <div className="grid-cards">
          {tiers.map((t) => (
            <div className="card" key={t.id} style={{ opacity: t.active ? 1 : 0.55 }}>
              <h3>{t.name} {!t.active && <span className="status-tag cancelled">inactive</span>}</h3>
              <p className="tier-amount">{fmtMoney(t.amount, t.currency)}<span className="tier-per"> Plan Amount</span></p>
              {t.description && <div className="sub">{t.description}</div>}
              <div className="sub">{t.unlimitedClasses ? "Unlimited classes" : `${t.sessionCount || 1} sessions`} · Valid for {t.intervalCount} {String(t.interval).toLowerCase()}{t.intervalCount === 1 ? "" : "s"} · {t.classTags?.length ? t.classTags.join(", ") : "All classes"}</div>
              {t.benefits?.length > 0 && <ul className="tier-benefits">{t.benefits.map((b, i) => <li key={i}>{b}</li>)}</ul>}
              <button className="btn ghost sm" style={{ marginTop: "0.7rem" }} onClick={() => openEdit(t)}>Edit</button>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit class plan" : "Add class plan"}
        footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy || !edit?.name}>Save</button></>}>
        {edit && (
          <div>
            <div className="field"><label>Name</label><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Sanctuary" /></div>
            <div className="field"><label>Description</label><input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
            <div className="field row">
              <div><label>Amount</label><input type="number" min="0" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></div>
              <div><label>Currency</label><select value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value })}><option>PHP</option><option>IDR</option><option>USD</option></select></div>
            </div>
            <div className="field row">
              <div><label>Validity unit</label><select value={edit.interval} onChange={(e) => setEdit({ ...edit, interval: e.target.value })}><option value="DAY">Day</option><option value="WEEK">Week</option><option value="MONTH">Month</option><option value="YEAR">Year</option></select></div>
              <div><label>Valid for</label><input type="number" min="1" value={edit.intervalCount} onChange={(e) => setEdit({ ...edit, intervalCount: e.target.value })} /></div>
            </div>
            <div className="field"><label>Class names or codes (comma separated; blank means All Access)</label>
              <input value={edit.classTags} onChange={(e) => setEdit({ ...edit, classTags: e.target.value })} placeholder="Vinyasa, VYB" /></div>
            <div className="field row">
              <div><label>Sessions included</label><input type="number" min="1" disabled={edit.unlimitedClasses}
                value={edit.sessionCount} onChange={(e) => setEdit({ ...edit, sessionCount: e.target.value })} /></div>
              <label style={{ alignSelf: "end", paddingBottom: ".65rem" }}><input type="checkbox" checked={edit.unlimitedClasses}
                onChange={(e) => setEdit({ ...edit, unlimitedClasses: e.target.checked })} /> Unlimited classes</label>
            </div>
            <div className="field"><label>Benefits (one per line)</label><textarea rows="3" value={edit.benefits} onChange={(e) => setEdit({ ...edit, benefits: e.target.value })} /></div>
            {edit.id && <label style={{ fontSize: "0.9rem" }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------- One-time class plan purchases ---------- */
function MembershipsView() {
  const [list, setList] = useState([]);
  const load = () => api("/memberships").then(({ memberships }) => setList(memberships));
  useEffect(() => { load(); }, []);
  const date = (value) => value ? new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium" }) : "—";
  const sessions = (value, unlimited) => unlimited ? "Unlimited" : (value ?? "—");
  const tag = (status) => status === "Active" ? "accepted"
    : status === "Fully Used" ? "pending"
      : ["Expired", "Cancelled"].includes(status) ? "cancelled" : "declined";

  return (
    <div className="page">
      <div className="page-head"><div><h1>Memberships</h1><p>One-time class plans and recurring subscriptions in one client ledger.</p></div></div>
      {list.length === 0 ? <div className="empty">No memberships yet.</div> : (
        <div className="purchase-table-wrap">
          <table className="purchase-table">
            <thead><tr><th>Client</th><th>Membership / Plan</th><th>Type</th><th>Class</th><th>Amount</th>
              <th>Sessions / Billing</th><th>Validity / Renewal</th><th>Expiration / Next Billing</th>
              <th>Payment</th><th>Plan Status</th><th /></tr></thead>
            <tbody>{list.map((record) => <tr key={record.id}>
              <td><Link className="client-record-link" to={`/dashboard/clients/${record.client?.id}`}>{record.client?.name || "Client"}</Link>
                <small>{record.client?.email}</small></td>
              <td>{record.purchasedPlan}</td>
              <td><span className={"status-tag " + (record.membershipType === "one_time" ? "pending" : "accepted")}>{record.membershipTypeLabel}</span></td>
              <td>{record.className}</td>
              <td>{fmtMoney(record.amountPaid, record.currency)}
                <small>{record.membershipType === "one_time" ? "One-Time Payment" : `per ${record.billingCycle}`}</small></td>
              <td>{record.membershipType === "one_time"
                ? <>{sessions(record.includedSessions, record.unlimitedClasses)} included<small>{sessions(record.usedSessions, record.unlimitedClasses)} used · {sessions(record.remainingSessions, record.unlimitedClasses)} remaining</small></>
                : <>Billing cycle<small>{record.billingCycle}</small></>}</td>
              <td>{record.membershipType === "one_time" ? record.validityPeriod : record.renewalStatus}</td>
              <td>{date(record.membershipType === "one_time" ? record.expirationDate : record.nextBillingDate)}</td>
              <td><span className={"status-tag " + (record.paymentStatus === "Paid" ? "accepted" : "pending")}>{record.paymentStatus}</span></td>
              <td><span className={"status-tag " + tag(record.planStatus)}>{record.planStatus}</span></td>
              <td><Link className="btn ghost sm" to={`/dashboard/clients/${record.client?.id}`}>View Details</Link></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
