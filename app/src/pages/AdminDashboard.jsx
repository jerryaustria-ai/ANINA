import { useEffect, useState } from "react";
import { api } from "../api.js";
import CalendarView from "../components/CalendarView.jsx";
import Modal from "../components/Modal.jsx";
import Avatar from "../components/Avatar.jsx";
import { useCalendar } from "../useCalendar.js";
import { fmtRange, fmtMoney, fmtInterval, STATUS_LABEL } from "../util.js";

export default function AdminDashboard({ view }) {
  if (view === "rooms") return <RoomsView />;
  if (view === "people") return <PeopleView />;
  if (view === "tiers") return <TiersView />;
  if (view === "memberships") return <MembershipsView />;
  return <ScheduleView />;
}

/* ---------- Studio-wide schedule ---------- */
function ScheduleView() {
  const cal = useCalendar();
  const [sessions, setSessions] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [hidden, setHidden] = useState(new Set());
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState(null);

  async function load() {
    const from = cal.range.from.toISOString();
    const to = cal.range.to.toISOString();
    const { sessions } = await api(`/sessions?from=${from}&to=${to}`);
    setSessions(sessions);
  }
  useEffect(() => { load().catch((e) => setMsg({ kind: "err", text: e.message })); }, [cal.range.from.getTime(), cal.range.to.getTime()]);
  useEffect(() => { api("/rooms").then(({ rooms }) => setRooms(rooms)); }, []);

  const toggle = (id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const events = sessions
    .filter((s) => !hidden.has(s.room?.id))
    .map((s) => ({
      id: s.id, title: s.title, startAt: s.startAt, endAt: s.endAt, color: s.color,
      sub: `${s.instructor?.name} · ${s.acceptedCount}/${s.capacity}`,
      badge: s.status === "confirmed" ? "✓" : s.status === "cancelled" ? "✕" : "",
      dim: s.status === "cancelled",
    }));

  return (
    <div className="page">
      <div className="page-head"><div><h1>Studio schedule</h1><p>Every class, every room, every instructor.</p></div></div>
      {msg && <div className={"banner " + msg.kind}>{msg.text}</div>}

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
        footer={sel && sel.status !== "cancelled" &&
          <button className="btn danger" onClick={() => api(`/sessions/${sel.id}/cancel`, { method: "POST" }).then(() => { setSel(null); load(); })}>Cancel class</button>}>
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
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------- Rooms & capacity ---------- */
const blankRoom = { name: "", maxCapacity: 10, location: "", color: "#8a9a5b", active: true };
function RoomsView() {
  const [rooms, setRooms] = useState([]);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api("/rooms?all=1").then(({ rooms }) => setRooms(rooms));
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const body = { name: edit.name, maxCapacity: Number(edit.maxCapacity), location: edit.location, color: edit.color, active: edit.active };
      if (edit.id) await api(`/rooms/${edit.id}`, { method: "PATCH", body });
      else await api("/rooms", { method: "POST", body });
      setEdit(null); await load();
    } catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head"><div><h1>Rooms</h1><p>Set each room's max capacity — classes can't exceed it.</p></div>
        <button className="btn" onClick={() => setEdit({ ...blankRoom })}>+ Add room</button></div>
      {msg && <div className={"banner " + msg.kind}>{msg.text}</div>}

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
const blankUser = { name: "", email: "", password: "", role: "client", picture: "" };

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
  const [msg, setMsg] = useState(null);
  const [add, setAdd] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api("/users").then(({ users }) => setUsers(users));
  useEffect(() => { load(); }, []);

  async function setRole(id, role) {
    setMsg(null);
    try { await api(`/users/${id}/role`, { method: "PATCH", body: { role } }); await load(); setMsg({ kind: "ok", text: "Role updated." }); }
    catch (e) { setMsg({ kind: "err", text: e.message }); }
  }

  async function setActive(u, active) {
    setMsg(null);
    try { await api(`/users/${u.id}/active`, { method: "PATCH", body: { active } }); await load();
      setMsg({ kind: "ok", text: `${u.name} ${active ? "reactivated" : "deactivated"}.` }); }
    catch (e) { setMsg({ kind: "err", text: e.message }); }
  }

  async function removeUser(u) {
    if (!window.confirm(`Permanently delete ${u.name} (${u.email})? This can't be undone.`)) return;
    setMsg(null);
    try { await api(`/users/${u.id}`, { method: "DELETE" }); await load(); setMsg({ kind: "ok", text: `${u.name} deleted.` }); }
    catch (e) { setMsg({ kind: "err", text: e.message }); }
  }

  async function createUser() {
    setBusy(true); setMsg(null);
    try {
      const { user } = await api("/users", { method: "POST", body: add });
      setAdd(null); await load();
      setMsg({ kind: "ok", text: `Added ${user.name} (${user.role}). They can sign in with email/password or Google.` });
    } catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>People</h1><p>Add users, promote clients to instructors, or manage admins.</p></div>
        <button className="btn" onClick={() => setAdd({ ...blankUser })}>+ Add user</button>
      </div>
      {msg && <div className={"banner " + msg.kind}>{msg.text}</div>}
      <ul className="roster">
        {users.map((u) => (
          <li key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
            <Avatar src={u.picture} name={u.name} size={34} />
            <div className="who">
              <div className="nm">{u.name} {!u.active && <span className="status-tag cancelled">inactive</span>}</div>
              <div className="em">{u.email}</div>
            </div>
            <span className={"role-pill " + u.role}>{u.role}</span>
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
                      catch (error) { setMsg({ kind: "err", text: error.message }); }
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
    </div>
  );
}

/* ---------- Membership tiers (admin-managed) ---------- */
const blankTier = { name: "", description: "", amount: 15000, currency: "PHP", interval: "MONTH", intervalCount: 1, benefits: "", active: true, sortOrder: 0 };
function TiersView() {
  const [tiers, setTiers] = useState([]);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api("/tiers?all=1").then(({ tiers }) => setTiers(tiers));
  useEffect(() => { load(); }, []);

  function openEdit(t) {
    setEdit(t ? { ...t, benefits: (t.benefits || []).join("\n") } : { ...blankTier });
  }
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const body = { ...edit, amount: Number(edit.amount), intervalCount: Number(edit.intervalCount),
        benefits: String(edit.benefits || "").split("\n").map((s) => s.trim()).filter(Boolean) };
      if (edit.id) await api(`/tiers/${edit.id}`, { method: "PATCH", body });
      else await api("/tiers", { method: "POST", body });
      setEdit(null); await load();
    } catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Membership tiers</h1><p>Plans clients can subscribe to. Amounts bill via Xendit on the interval you set.</p></div>
        <button className="btn" onClick={() => openEdit(null)}>+ Add tier</button>
      </div>
      {msg && <div className={"banner " + msg.kind}>{msg.text}</div>}

      {tiers.length === 0 ? <div className="empty">No tiers yet. Add one to let clients subscribe.</div> : (
        <div className="grid-cards">
          {tiers.map((t) => (
            <div className="card" key={t.id} style={{ opacity: t.active ? 1 : 0.55 }}>
              <h3>{t.name} {!t.active && <span className="status-tag cancelled">inactive</span>}</h3>
              <p className="tier-amount">{fmtMoney(t.amount, t.currency)}<span className="tier-per">{fmtInterval(t.interval, t.intervalCount)}</span></p>
              {t.description && <div className="sub">{t.description}</div>}
              {t.benefits?.length > 0 && <ul className="tier-benefits">{t.benefits.map((b, i) => <li key={i}>{b}</li>)}</ul>}
              <button className="btn ghost sm" style={{ marginTop: "0.7rem" }} onClick={() => openEdit(t)}>Edit</button>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit tier" : "Add tier"}
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
              <div><label>Interval</label><select value={edit.interval} onChange={(e) => setEdit({ ...edit, interval: e.target.value })}><option value="DAY">Day</option><option value="WEEK">Week</option><option value="MONTH">Month</option><option value="YEAR">Year</option></select></div>
              <div><label>Every</label><input type="number" min="1" value={edit.intervalCount} onChange={(e) => setEdit({ ...edit, intervalCount: e.target.value })} /></div>
            </div>
            <div className="field"><label>Benefits (one per line)</label><textarea rows="3" value={edit.benefits} onChange={(e) => setEdit({ ...edit, benefits: e.target.value })} /></div>
            {edit.id && <label style={{ fontSize: "0.9rem" }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------- Memberships monitor ---------- */
function MembershipsView() {
  const [list, setList] = useState([]);
  const [msg, setMsg] = useState(null);
  const load = () => api("/memberships").then(({ memberships }) => setList(memberships));
  useEffect(() => { load(); }, []);

  async function cancel(m) {
    if (!window.confirm(`Cancel ${m.client?.name}'s membership?`)) return;
    try { await api(`/memberships/${m.id}/cancel`, { method: "POST" }); await load(); }
    catch (e) { setMsg({ kind: "err", text: e.message }); }
  }
  const tag = (s) => s === "active" ? "accepted" : s === "past_due" ? "cancelled" : s === "cancelled" || s === "inactive" ? "declined" : "pending";

  return (
    <div className="page">
      <div className="page-head"><div><h1>Memberships</h1><p>Every client subscription and its billing status.</p></div></div>
      {msg && <div className={"banner " + msg.kind}>{msg.text}</div>}
      {list.length === 0 ? <div className="empty">No memberships yet.</div> : (
        <ul className="roster">
          {list.map((m) => (
            <li key={m.id}>
              <Avatar src={m.client?.picture} name={m.client?.name} size={34} />
              <div className="who"><div className="nm">{m.client?.name}</div><div className="em">{m.client?.email}</div></div>
              <div style={{ textAlign: "right", minWidth: 130 }}>
                <div className="nm">{m.tier?.name}</div>
                <div className="em">{fmtMoney(m.tier?.amount, m.tier?.currency)}{fmtInterval(m.tier?.interval, m.tier?.intervalCount)}</div>
              </div>
              <span className={"status-tag " + tag(m.status)}>{m.status.replace("_", " ")}</span>
              {["active", "pending", "past_due"].includes(m.status) && <button className="btn danger sm" onClick={() => cancel(m)}>Cancel</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
