import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { api } from "../api.js";

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api("/notifications?limit=100").then(({ notifications }) => setItems(notifications));
  useEffect(() => { load().catch((error) => toast.error(error.message)); }, []);

  async function markRead(item) {
    if (item.isRead) return;
    await api(`/notifications/${item.id}/read`, { method: "PATCH" });
    setItems((list) => list.map((value) => value.id === item.id ? { ...value, isRead: true } : value));
  }
  async function markAll() {
    setBusy(true);
    try {
      await api("/notifications/read-all", { method: "POST" });
      setItems((list) => list.map((item) => ({ ...item, isRead: true })));
      toast.success("All notifications marked as read.");
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  return <div className="page notification-history-page">
    <div className="page-head"><div><h1>Notifications</h1>
      <p>Your complete notification history, newest first.</p></div>
      <button className="btn ghost" onClick={markAll} disabled={busy}>Mark All as Read</button></div>
    {!items.length ? <div className="empty">No notifications yet.</div> :
      <div className="notification-history">{items.map((item) => <button key={item.id}
        className={`notification-history-item${item.isRead ? "" : " unread"}`}
        onClick={() => markRead(item).catch((error) => toast.error(error.message))}>
        <span className="notification-dot" />
        <span><strong>{item.title}</strong><span>{item.message}</span>
          <time>{new Date(item.createdAt).toLocaleString("en-PH")}</time></span>
        <em>{item.isRead ? "Read" : "Unread"}</em>
      </button>)}</div>}
  </div>;
}
