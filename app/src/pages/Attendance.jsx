import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { api } from "../api.js";
import Modal from "../components/Modal.jsx";
import { useAuth } from "../auth.jsx";
import { fmtRange, STATUS_LABEL } from "../util.js";

const OPTIONS = ["present", "absent", "late", "excused", "no_show"];
const label = (value) => STATUS_LABEL[value] || String(value || "pending").replaceAll("_", " ");

export default function Attendance() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [serverNow, setServerNow] = useState(null);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({});
  const [search, setSearch] = useState("");
  const [attendanceFilter, setAttendanceFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load(selectedId = null) {
    setLoading(true);
    try {
      const result = await api("/bookings/attendance");
      setSessions(result.sessions);
      setServerNow(new Date(result.serverNow));
      if (selectedId) {
        const updated = result.sessions.find((session) => session.id === selectedId);
        setSelected(updated || null);
        if (updated) setDraft(Object.fromEntries(updated.bookings.map((booking) =>
          [booking.id, booking.attendanceStatus || "pending"])));
      }
    } catch (error) { toast.error(error.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openAttendance(session) {
    setSelected(session);
    setDraft(Object.fromEntries(session.bookings.map((booking) =>
      [booking.id, booking.attendanceStatus || "pending"])));
    setSearch("");
    setAttendanceFilter("all");
    setPaymentFilter("all");
  }

  const visibleBookings = useMemo(() => {
    if (!selected) return [];
    const term = search.trim().toLowerCase();
    return selected.bookings.filter((booking) => {
      const matchesSearch = !term || booking.client?.name?.toLowerCase().includes(term) ||
        booking.client?.email?.toLowerCase().includes(term) ||
        booking.client?.phone?.toLowerCase().includes(term);
      const current = draft[booking.id] || booking.attendanceStatus || "pending";
      return matchesSearch &&
        (attendanceFilter === "all" || current === attendanceFilter) &&
        (paymentFilter === "all" || booking.paymentStatus === paymentFilter);
    });
  }, [selected, search, attendanceFilter, paymentFilter, draft]);

  const now = serverNow || new Date();
  const started = selected && now >= new Date(selected.startAt);
  const ended = selected && now >= new Date(selected.endAt);
  const canEdit = (booking) => Boolean(started && booking.paymentStatus === "paid" &&
    !(booking.checkInUsedAt && !["admin", "super_admin"].includes(user.role)));

  function markAllPresent() {
    if (!started) return toast.warning("Attendance is available only after the class starts.");
    setDraft((current) => {
      const next = { ...current };
      selected.bookings.forEach((booking) => { if (canEdit(booking)) next[booking.id] = "present"; });
      return next;
    });
  }

  async function saveAttendance() {
    const changes = selected.bookings.filter((booking) => canEdit(booking) &&
      draft[booking.id] && draft[booking.id] !== "pending" &&
      draft[booking.id] !== (booking.attendanceStatus || "pending"));
    if (!changes.length) return toast.info("No attendance changes to save.");
    setSaving(true);
    try {
      for (const booking of changes) {
        await api(`/bookings/${booking.id}/attendance`, {
          method: "POST", body: { status: draft[booking.id] },
        });
      }
      toast.success(`Attendance saved for ${changes.length} attendee${changes.length === 1 ? "" : "s"}.`);
      await load(selected.id);
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  }

  function classStatus(session) {
    if (now < new Date(session.startAt)) return "Not Started";
    const recorded = session.bookings.filter((booking) =>
      booking.attendanceStatus && booking.attendanceStatus !== "pending").length;
    if (now >= new Date(session.endAt) && recorded === session.bookings.length && session.bookings.length) {
      return "Finalized";
    }
    return now >= new Date(session.endAt) ? "Needs Finalization" : "Attendance Open";
  }

  return <div className="page attendance-page">
    <div className="page-head"><div><h1>Attendance</h1>
      <p>Manage attendance for published and scheduled classes.</p></div></div>
    {loading ? <div className="spinner">Loading attendance…</div>
      : !sessions.length ? <div className="empty">No published classes are available.</div>
        : <div className="purchase-table-wrap"><table className="purchase-table">
          <thead><tr><th>Class</th><th>Date and Time</th><th>Instructor</th><th>Room</th>
            <th>Booked</th><th>Capacity</th><th>Attendance Status</th><th>Action</th></tr></thead>
          <tbody>{sessions.map((session) => <tr key={session.id}>
            <td data-label="Class"><strong>{session.title}</strong></td>
            <td data-label="Date and Time">{fmtRange(session.startAt, session.endAt)}</td>
            <td data-label="Instructor">{session.instructor?.name || "—"}</td>
            <td data-label="Room">{session.room?.name || "—"}</td>
            <td data-label="Booked">{session.bookings.length}</td>
            <td data-label="Capacity">{session.capacity}</td>
            <td data-label="Attendance"><span className="status-tag pending">{classStatus(session)}</span></td>
            <td data-label="Action"><button className="btn ghost sm" onClick={() => openAttendance(session)}>View Attendance</button></td>
          </tr>)}</tbody>
        </table></div>}

    <Modal open={!!selected} onClose={() => !saving && setSelected(null)}
      title={selected ? `${selected.title} Attendance` : "Attendance"}
      footer={selected && <div className="attendance-modal-actions">
        <Link className="btn ghost" to="/dashboard/check-in">Scan QR Code</Link>
        <button className="btn ghost" onClick={markAllPresent} disabled={!started || saving}>Mark All Present</button>
        <button className="btn" onClick={saveAttendance} disabled={!started || saving}>
          {saving ? "Saving…" : ended ? "Save & Finalize Attendance" : "Save Attendance"}
        </button>
      </div>}>
      {selected && <div className="attendance-details">
        <div className="attendance-class-summary">
          <span>{fmtRange(selected.startAt, selected.endAt)}</span>
          <span>{selected.instructor?.name} · {selected.room?.name}</span>
          <span>{selected.bookings.length}/{selected.capacity} booked</span>
        </div>
        {!started && <div className="status-notice warning">
          Attendance actions will become available when the class starts.
        </div>}
        <div className="attendance-filters">
          <input placeholder="Search client name, email, or phone…" value={search}
            onChange={(event) => setSearch(event.target.value)} />
          <select value={attendanceFilter} onChange={(event) => setAttendanceFilter(event.target.value)}>
            <option value="all">All attendance</option><option value="pending">Pending</option>
            {OPTIONS.map((option) => <option value={option} key={option}>{label(option)}</option>)}
          </select>
          <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
            <option value="all">All payments</option><option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option><option value="pending">Pending Payment</option>
          </select>
        </div>
        {!visibleBookings.length ? <div className="empty">No attendees match the selected filters.</div>
          : <div className="attendance-roster">{visibleBookings.map((booking) =>
            <article className="attendance-attendee" key={booking.id}>
              <div className="attendance-attendee-head">
                <div><strong>{booking.client?.name || "Client"}</strong>
                  <span>{booking.client?.email || "—"} · {booking.client?.phone || "No phone"}</span></div>
                <span className="client-type">{booking.source === "guest_checkout" ? "Guest" : "Registered Client"}</span>
              </div>
              <div className="attendance-meta-grid">
                <span>Payment<strong>{booking.paymentStatus === "paid" ? "Paid" : "Pending Payment"}</strong></span>
                <span>Booking<strong>{label(booking.status)}</strong></span>
                <span>Check-in<strong>{booking.checkInUsedAt
                  ? new Date(booking.checkInUsedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })
                  : "Not checked in"}</strong></span>
                <span>Attendance<strong>{label(draft[booking.id] || booking.attendanceStatus)}</strong></span>
              </div>
              {booking.paymentStatus !== "paid" && <div className="attendance-payment-warning">
                Payment is still pending. Please complete your payment before attending the class.
              </div>}
              {booking.checkInUsedAt && !["admin", "super_admin"].includes(user.role) && <div className="attendance-lock-note">
                QR check-in confirmed. Only an Admin can change this attendance.
              </div>}
              <div className="attendance-choice">
                {OPTIONS.map((option) => <button key={option} type="button"
                  className={(draft[booking.id] === option ? "selected " : "") + option}
                  onClick={() => setDraft({ ...draft, [booking.id]: option })}
                  disabled={!canEdit(booking) || saving}>{label(option)}</button>)}
              </div>
            </article>)}</div>}
      </div>}
    </Modal>
  </div>;
}
