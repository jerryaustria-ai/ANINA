import { useEffect, useState } from "react";
import { api, downloadApi } from "../api.js";
import CalendarView from "../components/CalendarView.jsx";
import Modal from "../components/Modal.jsx";
import Avatar from "../components/Avatar.jsx";
import { useCalendar } from "../useCalendar.js";
import { useScheduleRefresh } from "../useScheduleRefresh.js";
import { fmtRange, fmtMoney, STATUS_LABEL, toLocalInput } from "../util.js";
import { toast } from "react-toastify";
import { Link } from "react-router-dom";

export default function AdminDashboard({ view }) {
  if (view === "overview") return <OverviewView />;
  if (view === "rooms") return <RoomsView />;
  if (view === "approvals") return <ScheduleApprovalView />;
  if (view === "audit") return <AuditTrailView />;
  if (view === "people") return <PeopleView />;
  if (view === "class-titles") return <ClassTitlesView />;
  if (view === "tiers") return <TiersView />;
  if (view === "payments") return <PaymentsView />;
  if (view === "memberships") return <MembershipsView />;
  return <ScheduleView />;
}

function OverviewView() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ from: "", to: "", status: "" });
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/reports/overview").then(setData).catch((error) => toast.error(error.message));
  }, []);

  async function loadReport(event) {
    event?.preventDefault();
    setBusy(true);
    try {
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
      const result = await api(`/reports/bookings?${query}`);
      setRows(result.rows);
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  async function exportReport(format) {
    try {
      const query = new URLSearchParams({ format });
      Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
      await downloadApi(`/reports/bookings/export?${query}`,
        `anina-bookings.${format === "excel" ? "xls" : "csv"}`);
      toast.success(`${format === "excel" ? "Excel" : "CSV"} report downloaded.`);
    } catch (error) { toast.error(error.message); }
  }

  const cards = data ? [
    ["Total bookings", data.metrics.totalBookings],
    ["Today's bookings", data.metrics.todayBookings],
    ["Upcoming bookings", data.metrics.upcomingBookings],
    ["Completed bookings", data.metrics.completedBookings],
    ["Cancelled bookings", data.metrics.cancelledBookings],
    ["Available instructors", data.metrics.availableInstructors],
    ["Total clients", data.metrics.totalClients],
    ["Pending approvals", data.metrics.pendingApprovals],
    ["Cancellation requests", data.metrics.cancellationRequests],
  ] : [];

  return <div className="page overview-page">
    <div className="page-head"><div><h1>Admin Dashboard</h1>
      <p>Studio activity, upcoming schedules, and operational reports.</p></div></div>
    <section className="overview-metrics">
      {cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
      {!data && <div className="empty">Loading dashboard…</div>}
    </section>
    <section className="overview-panel">
      <h2>Upcoming schedules</h2>
      {!data?.upcomingSessions?.length ? <div className="empty">No upcoming schedules.</div> :
        <div className="overview-upcoming">{data.upcomingSessions.map((session) => <div key={session.id}>
          <strong>{session.title}</strong><span>{fmtRange(session.startAt, session.endAt)}</span>
          <span>{session.instructor?.name} · {session.room?.name}</span>
        </div>)}</div>}
    </section>
    <section className="overview-panel">
      <h2>Booking reports</h2>
      <form className="report-filters" onSubmit={loadReport}>
        <label>From<input type="date" value={filters.from}
          onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label>To<input type="date" value={filters.to}
          onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <label>Status<select value={filters.status}
          onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">All statuses</option>
          {["pending", "accepted", "waitlisted", "cancelled", "attended", "no_show"].map((status) =>
            <option value={status} key={status}>{STATUS_LABEL[status] || status}</option>)}
        </select></label>
        <button className="btn" disabled={busy}>Generate</button>
        <button className="btn ghost" type="button" onClick={() => exportReport("csv")}>Export CSV</button>
        <button className="btn ghost" type="button" onClick={() => exportReport("excel")}>Export Excel</button>
        <button className="btn ghost" type="button" onClick={() => window.print()}>Print / Save PDF</button>
      </form>
      {rows.length > 0 && <div className="report-table-wrap"><table className="data-table report-table">
        <thead><tr><th>Client</th><th>Service</th><th>Instructor</th><th>Schedule</th>
          <th>Booking</th><th>Attendance</th><th>Payment</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.reference}>
          <td><strong>{row.client}</strong><small>{row.email}</small></td>
          <td>{row.service}</td><td>{row.instructor}</td>
          <td>{fmtRange(row.start, row.end)}</td>
          <td>{STATUS_LABEL[row.bookingStatus] || row.bookingStatus}</td>
          <td>{STATUS_LABEL[row.attendance] || row.attendance}</td><td>{row.payment}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
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
  const [classDefinitions, setClassDefinitions] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [hidden, setHidden] = useState(new Set());
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState(null);
  const [assign, setAssign] = useState(null);
  const [reschedule, setReschedule] = useState(null);
  const [scheduleReview, setScheduleReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const [, setClockTick] = useState(0);

  async function load() {
    const from = cal.range.from.toISOString();
    const to = cal.range.to.toISOString();
    const [sessionData, bookingData] = await Promise.all([
      api(`/sessions?from=${from}&to=${to}`),
      api("/bookings"),
    ]);
    setSessions(sessionData.sessions);
    setBookings(bookingData.bookings);
    if (bookingData.serverNow) setServerOffset(new Date(bookingData.serverNow).getTime() - Date.now());
    if (sel) setSel(sessionData.sessions.find((session) => session.id === sel.id) || null);
  }
  useEffect(() => { load().catch((e) => toast.error(e.message)); }, [cal.range.from.getTime(), cal.range.to.getTime()]);
  useScheduleRefresh(load);
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    Promise.all([api("/rooms"), api("/users"), api("/class-definitions")])
      .then(([roomData, userData, classData]) => {
        setRooms(roomData.rooms); setUsers(userData.users); setClassDefinitions(classData.classes);
      })
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
  const allSelectedBookings = sel ? bookings.filter((booking) => booking.session?.id === sel.id) : [];
  const selectedBookings = allSelectedBookings.filter((booking) =>
    ["pending", "accepted", "present", "waitlisted"].includes(booking.status));
  const historicalBookings = allSelectedBookings.filter((booking) =>
    !["pending", "accepted", "present", "waitlisted"].includes(booking.status));
  const serverNow = Date.now() + serverOffset;
  const selectedClassStarted = !!sel && serverNow >= new Date(sel.startAt).getTime();
  const selectedClassEnded = !!sel && serverNow >= new Date(sel.endAt).getTime();
  const displayedBookings = selectedClassEnded ? allSelectedBookings : selectedBookings;
  const serviceNames = [...new Set(sessions.map((session) => session.title).filter(Boolean))];

  const toggle = (id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function newSchedule() {
    const start = new Date();
    start.setDate(start.getDate() + 1); start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setEdit({
      classDefinition: classDefinitions[0]?.id || "",
      title: classDefinitions[0]?.title || "", type: classDefinitions[0]?.type || "group",
      instructor: instructors[0]?.id || "",
      room: classDefinitions[0]?.defaultRoom?.id || rooms[0]?.id || "",
      startAt: toLocalInput(start), endAt: toLocalInput(end),
      capacity: classDefinitions[0]?.type === "private" ? 1 : classDefinitions[0]?.defaultCapacity || 8,
      minToRun: classDefinitions[0]?.type === "private" ? 1 : classDefinitions[0]?.defaultMinToRun || 1,
      notes: "", status: "published", clientIds: [],
      recurring: false, recurrenceFrequency: "weekly", weekdays: [], until: "",
    });
  }

  function editSchedule(session) {
    const clientIds = bookings.filter((booking) =>
      booking.session?.id === session.id && ["pending", "accepted", "present", "waitlisted"].includes(booking.status))
      .map((booking) => booking.client?.id).filter(Boolean);
    setEdit({
      id: session.id, title: session.title, type: session.type,
      classDefinition: session.classDefinition?.id || session.classDefinition || "",
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
        classDefinition: edit.classDefinition || null,
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
        if (edit.recurring) {
          const result = await api("/sessions/recurring", {
            method: "POST",
            body: {
              ...body, weekdays: edit.weekdays, until: edit.until,
              frequency: edit.recurrenceFrequency,
            },
          });
          toast.success(`${result.count} recurring schedules created.`);
        } else {
          const { session } = await api("/sessions", { method: "POST", body });
          createdId = session.id;
          await api(`/sessions/${session.id}/clients`, { method: "PUT", body: { clientIds: edit.clientIds } });
          toast.success(`Schedule created with ${edit.clientIds.length} assigned client${edit.clientIds.length === 1 ? "" : "s"}.`);
        }
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

  async function recordAttendance(booking, status) {
    setBusy(true);
    try {
      await api(`/bookings/${booking.id}/attendance`, { method: "POST", body: { status } });
      await load();
      toast.success(`Attendance marked as ${status === "present" ? "Present" : status === "absent" ? "Absent" : "No Show"}.`);
    } catch (e) { e.status === 409 ? toast.warning(e.message) : toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function moveBooking() {
    setBusy(true);
    try {
      await api(`/bookings/${reschedule.booking.id}/reschedule`, {
        method: "POST", body: { sessionId: reschedule.sessionId },
      });
      setReschedule(null); await load();
      toast.success("Booking rescheduled.");
    } catch (e) {
      e.status === 409 ? toast.warning(e.message) : toast.error(e.message);
      await openBookingReschedule(reschedule.booking);
    }
    finally { setBusy(false); }
  }

  async function openBookingReschedule(booking) {
    setReschedule({ booking, sessionId: "", schedules: [], loading: true, error: "" });
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
        footer={sel && <>{sel.status === "pending_approval" ? <div className="schedule-review-actions">
          <button className="btn ghost" onClick={() => editSchedule(sel)}>Edit / Assign Room</button>
          <button className="btn danger" onClick={() => setScheduleReview({ session: sel, action: "reject", text: "" })} disabled={busy}>Reject</button>
          <button className="btn ghost" onClick={() => api(`/sessions/${sel.id}/hold`, { method: "POST", body: {} })
            .then(() => { toast.info("Schedule placed on hold."); setSel(null); return load(); })
            .catch((error) => toast.error(error.message))} disabled={busy}>Put on Hold</button>
          <button className="btn clay" onClick={() => setScheduleReview({ session: sel, action: "changes", text: "" })} disabled={busy}>Request Changes</button>
          <button className="btn schedule-review-primary" onClick={() => approveSchedule(sel)} disabled={busy}>Approve &amp; Publish</button>
        </div> : !selectedClassEnded ? <>
          <button className="btn ghost" onClick={() => editSchedule(sel)}>Edit / Reschedule</button>
          {sel.status === "on_hold" && <button className="btn" onClick={() =>
            api(`/sessions/${sel.id}/review-held`, { method: "POST", body: {} })
              .then(() => { toast.info("Schedule returned to the approval queue."); setSel(null); return load(); })
              .catch((error) => toast.error(error.message))
          } disabled={busy}>Return to Review</button>}
          {sel.status === "cancelled" &&
            sel.cancelledByRole === "instructor" &&
            String(sel.cancelledBy) === String(sel.instructor?.id) &&
            <button className="btn danger" onClick={() => deleteSchedule(sel)} disabled={busy}>Delete Session</button>}
          {sel.status !== "cancelled" && <button className="btn danger" onClick={() => cancelSchedule(sel)} disabled={busy}>Cancel Session</button>}
        </> : null}</>}>
        {sel && (
          <div>
            <div className="inst-row">
              <Avatar src={sel.instructor?.picture} name={sel.instructor?.name} size={44} />
              <div>
                <div className="inst-name">{sel.instructor?.name}</div>
                <div className="inst-label">Instructor</div>
              </div>
            </div>
            {selectedClassEnded && <div className="status-notice success"><strong>Completed Class Attendance Form</strong><br />Record or update each client’s final attendance.</div>}
            <p className="meta-line">🗓 {new Date(sel.startAt).toLocaleDateString("en-PH", { dateStyle: "full" })} · {new Date(sel.startAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} – {new Date(sel.endAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</p>
            <p className="meta-line">📍 {sel.room?.name}</p>
            <p className="meta-line">👥 {sel.acceptedCount}/{sel.minToRun} min · {sel.capacity} capacity</p>
            <p className="meta-line">Status: <span className={"status-tag " + (selectedClassEnded ? "completed" : sel.status)}>{selectedClassEnded ? "Completed" : STATUS_LABEL[sel.status]}</span></p>
            {sel.status === "cancelled" && <p className="meta-line">
              Cancelled by: <strong>{sel.cancelledByRole === "instructor" &&
                String(sel.cancelledBy) === String(sel.instructor?.id)
                ? `${sel.instructor?.name || "Assigned Instructor"} (Instructor)`
                : sel.cancelledByRole
                  ? sel.cancelledByRole[0].toUpperCase() + sel.cancelledByRole.slice(1)
                  : "Unknown / legacy record"}</strong>
              {sel.cancelledAt ? ` · ${new Date(sel.cancelledAt).toLocaleString()}` : ""}
            </p>}
            {sel.status === "cancellation_requested" && <div className="status-notice warning">
              <strong>Instructor requested cancellation.</strong><br />
              {sel.cancellationRequestReason || "No reason provided."}
              <br />Review and notify the affected clients before cancelling or rescheduling this class.
            </div>}
            <div className="schedule-detail-head"><h4>Client bookings</h4>
              {!selectedClassEnded && sel.status === "published" && sel.isPublished &&
                <button className="btn sm" onClick={() => setAssign({ sessionId: sel.id, clientIds: selectedBookings.map((booking) => booking.client?.id).filter(Boolean), capacity: sel.capacity })}>Manage clients</button>}</div>
            <p className="meta-line"><strong>{displayedBookings.length}</strong> assigned · <strong>{Math.max(0, sel.capacity - displayedBookings.length)}</strong> remaining slots</p>
            {displayedBookings.length === 0 ? <p className="meta-line">No client bookings.</p> :
              displayedBookings.map((booking) => (
                <div className="schedule-booking" key={booking.id}>
                  <div><strong>{booking.client?.name || "Client"}</strong><span>
                    <span className={"status-tag " + booking.status}>{STATUS_LABEL[booking.status] || booking.status}</span>
                    {booking.paymentStatus === "paid" ? " · Paid" : ""}
                  </span></div>
                  <div className="schedule-booking-actions">
                    {!selectedClassEnded && !["cancelled", "declined"].includes(booking.status) &&
                      <button className="btn ghost sm" onClick={() => openBookingReschedule(booking)}>Reschedule</button>}
                    {!selectedClassEnded && ["pending", "accepted", "waitlisted"].includes(booking.status) &&
                      <button className="btn danger sm" onClick={() => cancelBooking(booking)} disabled={busy}>Cancel</button>}
                    {selectedClassStarted && ["accepted", "present", "fully_used", "attended", "no_show"].includes(booking.status) && <>
                      <button className="btn sm" onClick={() => recordAttendance(booking, "present")} disabled={busy}>Present</button>
                      <button className="btn ghost sm" onClick={() => recordAttendance(booking, "absent")} disabled={busy}>Absent</button>
                      <button className="btn danger sm" onClick={() => recordAttendance(booking, "no_show")} disabled={busy}>No Show</button>
                    </>}
                  </div>
                </div>
              ))}
            {!selectedClassEnded && historicalBookings.length > 0 && <>
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
          <div className="field"><label>Official class title</label>
            <select value={edit.classDefinition || ""} onChange={(event) => {
              const definition = classDefinitions.find((item) => item.id === event.target.value);
              if (!definition) return;
              setEdit({
                ...edit,
                classDefinition: definition.id,
                title: definition.title,
                type: definition.type,
                room: definition.defaultRoom?.id || edit.room,
                capacity: definition.type === "private" ? 1 : definition.defaultCapacity,
                minToRun: definition.type === "private" ? 1 : definition.defaultMinToRun,
              });
            }}><option value="">Select an official class title</option>
              {classDefinitions.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}
            </select></div>
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
            <option value="pending_approval">Pending Approval</option>
            <option value="on_hold">On Hold</option>
            <option value="published">Published</option><option value="completed">Completed</option>
          </select></div>}
          {!edit.id && <div className="field recurring-fields">
            <label className="check-line"><input type="checkbox" checked={edit.recurring}
              onChange={(event) => setEdit({ ...edit, recurring: event.target.checked, clientIds: [] })} />
              Create a recurring schedule</label>
            {edit.recurring && <>
              <label>Frequency<select value={edit.recurrenceFrequency}
                onChange={(event) => setEdit({ ...edit, recurrenceFrequency: event.target.value })}>
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
              </select></label>
              {edit.recurrenceFrequency === "weekly" && <><label>Repeat on</label>
              <div className="weekday-picker">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) =>
                <label key={day}><input type="checkbox" checked={edit.weekdays.includes(index)}
                  onChange={() => setEdit({ ...edit, weekdays: edit.weekdays.includes(index)
                    ? edit.weekdays.filter((value) => value !== index) : [...edit.weekdays, index] })} />{day}</label>)}</div></>}
              <label>Repeat until<input type="date" min={edit.startAt.slice(0, 10)} value={edit.until}
                onChange={(event) => setEdit({ ...edit, until: event.target.value })} /></label>
              <p className="meta-line">Recurring schedules are created without client assignments. Clients can be added to each occurrence afterward.</p>
            </>}
          </div>}
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
          {reschedule.loading ? <div className="empty">Checking eligible schedules…</div>
            : reschedule.error ? <div className="status-notice error">{reschedule.error}</div>
              : reschedule.schedules.length === 0
                ? <div className="empty">No available schedules for this class are within your plan validity period.</div>
                : <div className="field"><label>Eligible replacement schedule</label>
                  <select value={reschedule.sessionId} onChange={(e) => setReschedule({ ...reschedule, sessionId: e.target.value })}>
                    <option value="">Select schedule</option>{reschedule.schedules.map((session) =>
                      <option value={session.id} key={session.id}>{session.title} — {fmtRange(session.startAt, session.endAt)} — {session.instructor?.name} — {session.seatsLeft} slot{session.seatsLeft === 1 ? "" : "s"} left</option>)}
                  </select></div>}</div>}
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
  const requests = (() => {
    const grouped = new Map();
    sessions.forEach((session) => {
      const key = session.recurrenceGroupId || `single:${session.id}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          ...session,
          requestId: key,
          recurring: !!session.recurrenceGroupId,
          occurrences: [],
        });
      }
      grouped.get(key).occurrences.push(session);
    });
    return [...grouped.values()].map((request) => {
      const occurrences = request.occurrences.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
      return { ...request, ...occurrences[0], requestId: request.requestId, recurring: request.recurring, occurrences };
    }).sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  })();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("schedule");
    const request = id && requests.find((item) => item.occurrences.some((occurrence) => occurrence.id === id));
    if (request) openDetails(request);
  }, [sessions]);

  function openDetails(request) {
    setDetail({
      request,
      selectedIds: request.occurrences.map((occurrence) => occurrence.id),
      errors: {},
    });
  }

  async function approve(session) {
    setBusy(true);
    try {
      await api(`/sessions/${session.id}/approve`, { method: "POST" });
      toast.success("Schedule approved and published successfully.");
      setDetail(null); await load();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  async function approveSelected() {
    const selected = detail?.selectedIds || [];
    if (!selected.length) return toast.warning("Select at least one schedule occurrence to approve.");
    setBusy(true);
    try {
      const errors = {};
      const approvedIds = [];
      for (const occurrence of detail.request.occurrences.filter((item) => selected.includes(item.id))) {
        try {
          await api(`/sessions/${occurrence.id}/approve`, { method: "POST" });
          approvedIds.push(occurrence.id);
        } catch (error) {
          errors[occurrence.id] = error.message || "This occurrence has a schedule conflict.";
        }
      }
      const remaining = detail.request.occurrences.filter((item) => !approvedIds.includes(item.id));
      if (approvedIds.length) {
        toast.success(`${approvedIds.length} occurrence${approvedIds.length === 1 ? "" : "s"} approved and published.`);
      }
      if (Object.keys(errors).length) {
        toast.warning("Some selected occurrences have conflicts and remain pending.");
      }
      await load();
      if (!remaining.length) setDetail(null);
      else setDetail({
        request: { ...detail.request, occurrences: remaining },
        selectedIds: selected.filter((id) => !approvedIds.includes(id)),
        errors,
      });
    } finally {
      setBusy(false);
    }
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
  async function hold(session) {
    const reason = window.prompt("Optional reason for placing this schedule on hold:") ?? null;
    if (reason === null) return;
    setBusy(true);
    try {
      await api(`/sessions/${session.id}/hold`, { method: "POST", body: { reason } });
      toast.info("Schedule placed on hold.");
      setDetail(null);
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  const details = (session, occurrences = [session]) => {
    const lastOccurrence = occurrences[occurrences.length - 1] || session;
    return <div className="approval-details">
    <p><strong>{session.title}</strong></p>
    <p className="meta-line">Instructor: {session.instructor?.name}<br />
      {occurrences.length > 1
        ? <>Recurring occurrences: {occurrences.length}<br />
          Date range: {fmtRange(session.startAt, session.endAt)} through {fmtRange(lastOccurrence.startAt, lastOccurrence.endAt)}<br /></>
        : <>Date and time: {fmtRange(session.startAt, session.endAt)}<br /></>}
      Location: {session.room?.name}{session.room?.location ? ` — ${session.room.location}` : ""}<br />
      Capacity: {session.capacity} · Minimum clients: {session.minToRun}<br />
      Type: {session.type}<br />
      Description / notes: {session.notes || "—"}<br />
      Submitted: {session.submittedAt ? new Date(session.submittedAt).toLocaleString() : "—"}<br />
      Status: {STATUS_LABEL[session.status] || session.status.replaceAll("_", " ")}</p>
    </div>;
  };

  return <div className="page">
    <div className="page-head"><div><h1>Schedule Approval</h1><p>Review Instructor-submitted schedules before clients can see or book them.</p></div></div>
    {!requests.length ? <div className="empty">No schedules are waiting for approval.</div> :
      <div className="grid-cards">{requests.map((request) => <div className="card" key={request.requestId}>
        {details(request, request.occurrences)}
        <div className="approval-actions">
          <button className="btn ghost sm" onClick={() => openDetails(request)}>View Details</button>
          {!request.recurring && <>
            <button className="btn sm" onClick={() => approve(request)} disabled={busy}>Approve & Publish</button>
            <button className="btn ghost sm" onClick={() => hold(request)} disabled={busy}>Put on Hold</button>
            <button className="btn danger sm" onClick={() => setReview({ session: request, action: "reject", text: "" })}>Reject</button>
            <button className="btn clay sm" onClick={() => setReview({ session: request, action: "changes", text: "" })}>Request changes</button>
          </>}
        </div>
      </div>)}</div>}

    <Modal open={!!detail} onClose={() => setDetail(null)}
      title={detail?.request.recurring ? "Recurring Schedule Details" : "Schedule Details"}
      footer={detail && (detail.request.recurring
        ? <><button className="btn ghost" onClick={() => setDetail(null)}>Close</button>
          <button className="btn" onClick={approveSelected}
            disabled={busy || !detail.selectedIds.length}>Approve Selected</button></>
        : <><button className="btn danger" onClick={() => setReview({ session: detail.request, action: "reject", text: "" })}>Reject</button>
          <button className="btn clay" onClick={() => setReview({ session: detail.request, action: "changes", text: "" })}>Request changes</button>
          <button className="btn ghost" onClick={() => hold(detail.request)} disabled={busy}>Put on Hold</button>
          <button className="btn" onClick={() => approve(detail.request)} disabled={busy}>Approve & Publish</button></>)}>
      {detail && (detail.request.recurring ? <div className="recurring-approval">
        {details(detail.request, detail.request.occurrences)}
        <div className="recurring-approval-head">
          <strong>Select occurrences to approve</strong>
          <span>{detail.selectedIds.length} of {detail.request.occurrences.length} selected</span>
        </div>
        <div className="recurring-occurrences">
          {detail.request.occurrences.map((occurrence) => <label
            className={"recurring-occurrence" + (detail.errors[occurrence.id] ? " has-conflict" : "")}
            key={occurrence.id}>
            <input type="checkbox" checked={detail.selectedIds.includes(occurrence.id)} disabled={busy}
              onChange={() => setDetail((current) => ({
                ...current,
                selectedIds: current.selectedIds.includes(occurrence.id)
                  ? current.selectedIds.filter((id) => id !== occurrence.id)
                  : [...current.selectedIds, occurrence.id],
                errors: { ...current.errors, [occurrence.id]: undefined },
              }))} />
            <span><strong>{new Date(occurrence.startAt).toLocaleDateString("en-PH", {
              weekday: "long", month: "long", day: "numeric", year: "numeric",
            })}</strong>
              <small>{new Date(occurrence.startAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                {" – "}{new Date(occurrence.endAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</small>
              {detail.errors[occurrence.id] &&
                <em>⚠ {detail.errors[occurrence.id]}</em>}</span>
          </label>)}
        </div>
      </div> : details(detail.request))}
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

/* ---------- Official class titles ---------- */
const blankClassTitle = {
  title: "", description: "", type: "group", defaultRoom: "",
  defaultCapacity: 8, defaultMinToRun: 1, cashPrice: 0, active: true,
};
function ClassTitlesView() {
  const [items, setItems] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    const [classData, roomData] = await Promise.all([
      api("/class-definitions?all=1"), api("/rooms"),
    ]);
    setItems(classData.classes);
    setRooms(roomData.rooms);
  }
  useEffect(() => { load().catch((error) => toast.error(error.message)); }, []);

  async function save() {
    setBusy(true);
    try {
      const body = {
        ...edit,
        defaultRoom: edit.defaultRoom?.id || edit.defaultRoom || null,
        defaultCapacity: Number(edit.defaultCapacity),
        defaultMinToRun: Number(edit.defaultMinToRun),
        cashPrice: Number(edit.cashPrice || 0),
      };
      if (edit.id) await api(`/class-definitions/${edit.id}`, { method: "PATCH", body });
      else await api("/class-definitions", { method: "POST", body });
      toast.success(edit.id ? "Official class title updated." : "Official class title created.");
      setEdit(null);
      await load();
    } catch (error) { error.status === 409 ? toast.warning(error.message) : toast.error(error.message); }
    finally { setBusy(false); }
  }
  async function importExisting() {
    try {
      const result = await api("/class-definitions/import-existing", { method: "POST" });
      await load();
      toast.success(result.imported
        ? `${result.imported} existing class title${result.imported === 1 ? "" : "s"} imported.`
        : "All existing class titles are already available.");
    } catch (error) { toast.error(error.message); }
  }
  const maximumCapacity = Number(edit?.defaultCapacity);
  const selectedRoomCapacity = rooms.find((room) =>
    room.id === (edit?.defaultRoom?.id || edit?.defaultRoom))?.maxCapacity;
  const maximumIsValid = edit?.type === "private" || (
    Number.isInteger(maximumCapacity) &&
    maximumCapacity >= 1 &&
    (!selectedRoomCapacity || maximumCapacity <= selectedRoomCapacity)
  );
  const minimumParticipants = Number(edit?.defaultMinToRun);
  const minimumIsValid = edit?.type === "private" || (
    Number.isInteger(minimumParticipants) &&
    minimumParticipants >= 1 &&
    minimumParticipants <= maximumCapacity
  );

  return <div className="page">
    <div className="page-head"><div><h1>Classes</h1>
      <p>Manage the classes available for scheduling.</p></div>
      <div className="page-actions"><button className="btn ghost" onClick={importExisting}>Import Existing Titles</button>
        <button className="btn" onClick={() => setEdit({ ...blankClassTitle })}>+ Create Class Title</button></div></div>
    <div className="grid-cards">{items.map((item) => <article className="card" key={item.id}
      style={{ opacity: item.active ? 1 : .55 }}>
      <h3>{item.title}</h3><p className="sub">{item.description || "No description"}</p>
      <p className="meta-line">{item.type === "private" ? "Private 1:1" : "Group Class"}<br />
        Default room: {item.defaultRoom?.name || "Not assigned"}<br />
        Capacity: {item.defaultCapacity} · Minimum: {item.defaultMinToRun}</p>
      <p className="meta-line">Regular cash price: {fmtMoney(item.cashPrice || 0, "PHP")}</p>
      <button className="btn ghost sm" onClick={() => setEdit({
        ...item, defaultRoom: item.defaultRoom?.id || "",
      })}>Edit</button>
    </article>)}</div>
    <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit Class Title" : "Create Class Title"}
      footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn" onClick={save}
          disabled={busy || !edit?.title.trim() || !maximumIsValid || !minimumIsValid}>Save</button></>}>
      {edit && <div>
        <div className="field"><label>Class title</label><input value={edit.title}
          onChange={(event) => setEdit({ ...edit, title: event.target.value })} /></div>
        <div className="field"><label>Description</label><textarea rows="3" value={edit.description}
          onChange={(event) => setEdit({ ...edit, description: event.target.value })} /></div>
        <div className="field row"><div><label>Class type</label><select value={edit.type}
          onChange={(event) => {
            const type = event.target.value;
            const selectedRoom = rooms.find((room) => room.id === edit.defaultRoom);
            const capacity = type === "private" ? 1 : selectedRoom?.maxCapacity || edit.defaultCapacity;
            setEdit({
              ...edit, type,
              defaultCapacity: capacity,
              defaultMinToRun: type === "private" ? 1 : Math.min(Number(edit.defaultMinToRun) || 1, capacity),
            });
          }}><option value="group">Group Class</option><option value="private">Private 1:1</option></select></div>
          <div><label>Default room</label><select value={edit.defaultRoom || ""}
            onChange={(event) => {
              const defaultRoom = event.target.value;
              const selectedRoom = rooms.find((room) => room.id === defaultRoom);
              const capacity = edit.type === "private" ? 1 : selectedRoom?.maxCapacity || edit.defaultCapacity;
              setEdit({
                ...edit,
                defaultRoom,
                defaultCapacity: capacity,
                defaultMinToRun: Math.min(Number(edit.defaultMinToRun) || 1, capacity),
              });
            }}>
            <option value="">No default room</option>{rooms.map((room) =>
              <option value={room.id} key={room.id}>{room.name} (max {room.maxCapacity})</option>)}
          </select></div></div>
        <div className="field row"><div><label>Maximum capacity</label><input type="number" min="1"
          max={rooms.find((room) => room.id === edit.defaultRoom)?.maxCapacity}
          disabled={edit.type === "private"} value={edit.defaultCapacity}
          onChange={(event) => {
            const capacity = Math.max(1, Number(event.target.value) || 1);
            setEdit({
              ...edit,
              defaultCapacity: event.target.value,
              defaultMinToRun: Math.min(Number(edit.defaultMinToRun) || 1, capacity),
            });
          }} />
          {!!edit.defaultRoom && edit.type !== "private" &&
            <small>Defaults to the room capacity, but may be reduced manually.</small>}
          {!maximumIsValid && <small className="field-error">
            Maximum Capacity must be between 1 and the selected room capacity ({selectedRoomCapacity}).
          </small>}</div>
          <div><label>Minimum participants</label><input type="number" min="1" max={edit.defaultCapacity}
            disabled={edit.type === "private"} value={edit.defaultMinToRun}
            aria-invalid={!minimumIsValid}
            onChange={(event) => setEdit({ ...edit, defaultMinToRun: event.target.value })} />
            {!minimumIsValid && <small className="field-error">
              Minimum Participants must be between 1 and Maximum Capacity ({edit.defaultCapacity}).
            </small>}</div></div>
        <div className="field"><label>Regular cash price</label><input type="number" min="0" step="0.01"
          value={edit.cashPrice ?? 0}
          onChange={(event) => setEdit({ ...edit, cashPrice: event.target.value })} />
          <small>Used when a client books this class with Cash Payment without an active plan.</small></div>
        {edit.id && <label className="check-line"><input type="checkbox" checked={edit.active}
          onChange={(event) => setEdit({ ...edit, active: event.target.checked })} />Active</label>}
      </div>}
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
  benefits: "", eligibleClassIds: [], sessionCount: 1, unlimitedClasses: false,
  firstTimerOnly: false, active: true, sortOrder: 0 };
function TiersView() {
  const [tiers, setTiers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [tierData, classData] = await Promise.all([
      api("/tiers?all=1"), api("/class-definitions?all=1"),
    ]);
    setTiers(tierData.tiers);
    setClasses(classData.classes.filter((item) => item.active));
  };
  useEffect(() => { load(); }, []);

  function openEdit(t) {
    setEdit(t ? {
      ...t,
      benefits: (t.benefits || []).join("\n"),
      eligibleClassIds: t.eligibleClassIds || [],
      sessionCount: t.unlimitedClasses ? null : Math.max(1, Number(t.sessionCount) || 1),
    } : { ...blankTier, eligibleClassIds: [] });
  }
  async function save() {
    setBusy(true);
    try {
      const body = { ...edit, amount: Number(edit.amount), intervalCount: Number(edit.intervalCount),
        sessionCount: edit.unlimitedClasses ? null : Math.max(1, Number(edit.sessionCount) || 1),
        firstTimerOnly: edit.firstTimerOnly === true,
        benefits: String(edit.benefits || "").split("\n").map((s) => s.trim()).filter(Boolean),
        eligibleClassIds: edit.eligibleClassIds };
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
              <div className="sub">Valid for {t.intervalCount} {String(t.interval).toLowerCase()}{t.intervalCount === 1 ? "" : "s"} · Eligible: {(t.eligibleClasses || []).map((item) => item.title).join(", ") || "None"}</div>
              {t.firstTimerOnly && <div className="status-tag pending" style={{ marginTop: ".55rem" }}>First Timer Only</div>}
              {t.benefits?.length > 0 && <ul className="tier-benefits">{t.benefits.map((b, i) => <li key={i}>{b}</li>)}</ul>}
              <button className="btn ghost sm" style={{ marginTop: "0.7rem" }} onClick={() => openEdit(t)}>Edit</button>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit class plan" : "Add class plan"}
        footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn" onClick={save}
            disabled={busy || !edit?.name || !edit?.eligibleClassIds?.length}>Save</button></>}>
        {edit && (
          <div>
            <div className="field"><label>Name</label><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Sanctuary" /></div>
            <div className="field"><label>Description</label><input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
            <div className="field row">
              <div><label>Amount</label><input type="number" min="0" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></div>
              <div><label>Currency</label><select value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value })}><option>PHP</option><option>IDR</option><option>USD</option></select></div>
            </div>
            <div className="field row">
              <div><label>Booking Credits</label><input type="number" min="1"
                disabled={edit.unlimitedClasses} value={edit.sessionCount ?? 1}
                onChange={(e) => setEdit({ ...edit, sessionCount: e.target.value })} /></div>
              <label className="plan-checkbox">
                <input type="checkbox" checked={edit.unlimitedClasses === true}
                  onChange={(e) => setEdit({ ...edit, unlimitedClasses: e.target.checked })} />
                <span><strong>Unlimited classes</strong><small>No credit limit during validity.</small></span>
              </label>
            </div>
            <div className="field row">
              <div><label>Validity unit</label><select value={edit.interval} onChange={(e) => setEdit({ ...edit, interval: e.target.value })}><option value="DAY">Day</option><option value="WEEK">Week</option><option value="MONTH">Month</option><option value="YEAR">Year</option></select></div>
              <div><label>Valid for</label><input type="number" min="1" value={edit.intervalCount} onChange={(e) => setEdit({ ...edit, intervalCount: e.target.value })} /></div>
            </div>
            <div className="field"><label>Eligible Classes <span aria-hidden="true">*</span></label>
              <div className="client-picker-list">
                {classes.map((item) => {
                  const selected = edit.eligibleClassIds.includes(item.id);
                  return <label className="client-picker-option" key={item.id}>
                    <input type="checkbox" checked={selected} onChange={(event) => {
                      const eligibleClassIds = event.target.checked
                        ? [...new Set([...edit.eligibleClassIds, item.id])]
                        : edit.eligibleClassIds.filter((id) => id !== item.id);
                      setEdit({ ...edit, eligibleClassIds });
                    }} />
                    <span><strong>{item.title}</strong></span>
                  </label>;
                })}
              </div>
              {!classes.length && <small>Create an active Class first.</small>}
            </div>
            <div className="field"><label>Benefits (one per line)</label><textarea rows="3" value={edit.benefits} onChange={(e) => setEdit({ ...edit, benefits: e.target.value })} /></div>
            <label className="plan-checkbox" htmlFor="first-timer-only">
              <input id="first-timer-only" type="checkbox" checked={edit.firstTimerOnly === true}
                onChange={(e) => setEdit((current) => ({ ...current, firstTimerOnly: e.target.checked }))} />
              <span><strong>First Timer Only</strong><small>Restrict this plan to clients without previous bookings, memberships, or successful payments.</small></span>
            </label>
            {edit.id && <label style={{ fontSize: "0.9rem" }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------- Cash payments ---------- */
function PaymentsView() {
  const [status, setStatus] = useState("pending");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [action, setAction] = useState(null);
  const [form, setForm] = useState({ paymentReference: "", notes: "" });
  const [working, setWorking] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const result = await api(`/guest-checkout/cash-payments?status=${status}`);
      setList(result.payments);
    } catch (error) { toast.error(error.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [status]);

  const dateTime = (value) => value ? new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium", timeStyle: "short",
  }) : "—";
  const statusLabel = (value) => ({
    pending: "Pending Payment", paid: "Paid", cancelled: "Cancelled",
    active: "Active", enrolled: "Enrolled", pending_email_confirmation: "Pending Email Confirmation",
  }[value] || String(value || "—").replaceAll("_", " "));

  function openAction(type, record) {
    setForm({ paymentReference: record.paymentReference || "", notes: "" });
    setAction({ type, record });
  }
  async function submitAction() {
    if (!action) return;
    const isPaid = action.type === "paid";
    const question = isPaid
      ? `Confirm that cash payment from ${action.record.client.name} has been received?`
      : `Cancel the pending cash payment for ${action.record.client.name}?`;
    if (!window.confirm(question)) return;
    setWorking(true);
    try {
      await api(`/guest-checkout/orders/${action.record.id}/${isPaid ? "mark-cash-paid" : "cancel-cash-payment"}`, {
        method: "POST",
        body: isPaid ? form : { notes: form.notes },
      });
      toast.success(isPaid
        ? "Cash payment marked as Paid. Enrollment is now active."
        : "Cash payment cancelled.");
      setAction(null);
      setDetail(null);
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setWorking(false); }
  }

  return <div className="page">
    <div className="page-head"><div><h1>Payments</h1>
      <p>Manage pending, paid, and cancelled cash payments.</p></div></div>
    <div className="app-tabs payment-tabs">
      {[["pending", "Pending Payments"], ["paid", "Paid Payments"], ["cancelled", "Cancelled Payments"]]
        .map(([value, label]) => <button key={value} className={`app-tab${status === value ? " active" : ""}`}
          onClick={() => setStatus(value)}>{label}</button>)}
    </div>
    {loading ? <div className="spinner">Loading payments…</div>
      : !list.length ? <div className="empty">No {statusLabel(status).toLowerCase()} records.</div>
        : <div className="purchase-table-wrap"><table className="purchase-table">
          <thead><tr><th>Client</th><th>Plan / Package</th><th>Amount</th><th>Booking Date</th>
            <th>Method</th><th>Payment Status</th><th>Enrollment Status</th><th>Actions</th></tr></thead>
          <tbody>{list.map((record) => <tr key={record.id}>
            <td><strong>{record.client.name}</strong><small>{record.client.email}</small></td>
            <td>{record.planName}<small>{record.className}</small></td>
            <td>{fmtMoney(record.amount, record.currency)}</td>
            <td>{dateTime(record.bookingDate)}</td>
            <td>{record.paymentMethod}</td>
            <td><span className={`status-tag ${record.paymentStatus === "paid" ? "accepted"
              : record.paymentStatus === "cancelled" ? "cancelled" : "pending"}`}>
              {statusLabel(record.paymentStatus)}</span></td>
            <td><span className={`status-tag ${record.enrollmentStatus === "active" ? "accepted" : "pending"}`}>
              {statusLabel(record.enrollmentStatus)}</span></td>
            <td><div className="table-actions">
              <button className="btn ghost sm" onClick={() => setDetail(record)}>View</button>
              {record.paymentStatus === "pending" && <>
                <button className="btn sm" onClick={() => openAction("paid", record)}>Mark as Paid</button>
                <button className="btn danger sm" onClick={() => openAction("cancel", record)}>Cancel</button>
              </>}
            </div></td>
          </tr>)}</tbody>
        </table></div>}

    <Modal open={!!detail} onClose={() => setDetail(null)} title="Cash Payment Details"
      footer={<button className="btn ghost" onClick={() => setDetail(null)}>Close</button>}>
      {detail && <dl className="detail-list">
        <div><dt>Client</dt><dd>{detail.client.name}</dd></div>
        <div><dt>Email</dt><dd>{detail.client.email}</dd></div>
        <div><dt>Phone</dt><dd>{detail.client.phone || "—"}</dd></div>
        <div><dt>Booking Reference</dt><dd>{detail.referenceId}</dd></div>
        <div><dt>Plan / Package</dt><dd>{detail.planName}</dd></div>
        <div><dt>Class</dt><dd>{detail.className}</dd></div>
        <div><dt>Instructor</dt><dd>{detail.instructorName}</dd></div>
        <div><dt>Schedule</dt><dd>{dateTime(detail.scheduleStart)}</dd></div>
        <div><dt>Amount</dt><dd>{fmtMoney(detail.amount, detail.currency)}</dd></div>
        <div><dt>Payment Status</dt><dd>{statusLabel(detail.paymentStatus)}</dd></div>
        <div><dt>Enrollment Status</dt><dd>{statusLabel(detail.enrollmentStatus)}</dd></div>
        <div><dt>Paid Date</dt><dd>{dateTime(detail.paidAt)}</dd></div>
        <div><dt>Paid By</dt><dd>{detail.paidBy?.name || "—"}</dd></div>
        <div><dt>Payment Reference</dt><dd>{detail.paymentReference || "—"}</dd></div>
        <div><dt>Notes</dt><dd>{detail.paymentNotes || detail.cancellationNotes || "—"}</dd></div>
      </dl>}
    </Modal>

    <Modal open={!!action} onClose={() => !working && setAction(null)}
      title={action?.type === "paid" ? "Mark Cash Payment as Paid" : "Cancel Cash Payment"}
      footer={<><button className="btn ghost" disabled={working} onClick={() => setAction(null)}>Close</button>
        <button className={`btn ${action?.type === "cancel" ? "danger" : ""}`} disabled={working}
          onClick={submitAction}>{working ? "Saving…" : action?.type === "paid" ? "Mark as Paid" : "Cancel Payment"}</button></>}>
      {action && <div className="form-grid">
        <p className="span-2">{action.type === "paid"
          ? `Confirm receipt of ${fmtMoney(action.record.amount, action.record.currency)} from ${action.record.client.name}.`
          : `This will cancel the unpaid enrollment for ${action.record.client.name}.`}</p>
        {action.type === "paid" && <div className="field span-2"><label>Payment Reference (optional)</label>
          <input value={form.paymentReference}
            onChange={(event) => setForm({ ...form, paymentReference: event.target.value })} /></div>}
        <div className="field span-2"><label>Notes (optional)</label>
          <textarea rows="3" value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
      </div>}
    </Modal>
  </div>;
}

/* ---------- One-time class plan purchases ---------- */
function MembershipsView() {
  const [list, setList] = useState([]);
  const load = () => api("/memberships").then(({ memberships }) => setList(memberships));
  useEffect(() => { load(); }, []);
  async function markCashPaid(record) {
    if (!window.confirm(`Mark cash payment for ${record.client?.name || "this client"} as Paid?`)) return;
    try {
      await api(`/guest-checkout/orders/${record.id}/mark-cash-paid`, { method: "POST" });
      toast.success("Cash payment marked as Paid.");
      await load();
    } catch (error) { toast.error(error.message); }
  }
  const date = (value) => value ? new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium" }) : "—";
  const tag = (status) => status === "Active" ? "accepted"
    : status === "Fully Used" ? "pending"
      : ["Expired", "Cancelled"].includes(status) ? "cancelled" : "declined";

  return (
    <div className="page">
      <div className="page-head"><div><h1>Memberships</h1><p>One-time class plans and recurring subscriptions in one client ledger.</p></div></div>
      {list.length === 0 ? <div className="empty">No memberships yet.</div> : (
        <div className="purchase-table-wrap">
          <table className="purchase-table">
            <thead><tr><th>Client</th><th>Membership / Plan</th><th>Class</th><th>Amount</th>
              <th>Billing Cycle</th><th>Validity / Renewal</th><th>Expiration / Next Billing</th>
              <th>Payment</th><th>Plan Status</th><th>Action</th></tr></thead>
            <tbody>{list.map((record) => <tr key={record.id}>
              <td><Link className="client-record-link" to={`/dashboard/clients/${record.client?.id}`}>{record.client?.name || "Client"}</Link>
                <small>{record.client?.email}</small></td>
              <td>{record.purchasedPlan}</td>
              <td>{record.className}</td>
              <td>{fmtMoney(record.amountPaid, record.currency)}
                <small>{record.membershipType === "one_time" ? "One-Time Payment" : `per ${record.billingCycle}`}</small></td>
              <td>{record.membershipType === "one_time" ? "—" : record.billingCycle}</td>
              <td>{record.membershipType === "one_time" ? record.validityPeriod : record.renewalStatus}</td>
              <td>{date(record.membershipType === "one_time" ? record.expirationDate : record.nextBillingDate)}</td>
              <td><span className={"status-tag " + (record.paymentStatus === "Paid" ? "accepted" : "pending")}>{record.paymentStatus}</span></td>
              <td><span className={"status-tag " + tag(record.planStatus)}>{record.planStatus}</span></td>
              <td>{record.paymentStatus === "Pending Cash Payment"
                ? <button className="btn sm" onClick={() => markCashPaid(record)}>Mark as Paid</button>
                : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
