import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { api } from "../api.js";

const ERROR_TYPES = new Set(["BOOKING_DECLINED", "BOOKING_CANCELLED", "SCHEDULE_CANCELLED"]);
const WARNING_TYPES = new Set(["SCHEDULE_UPDATED", "SCHEDULE_RESCHEDULED", "INSTRUCTOR_CHANGED", "CLIENT_REMOVED_FROM_SCHEDULE"]);
const SUCCESS_TYPES = new Set(["BOOKING_APPROVED", "BOOKING_CONFIRMED", "CLIENT_ADDED_TO_SCHEDULE"]);

function showArrival(notification) {
  if (ERROR_TYPES.has(notification.type)) toast.error(notification.message);
  else if (WARNING_TYPES.has(notification.type)) toast.warning(notification.message);
  else if (SUCCESS_TYPES.has(notification.type)) toast.success(notification.message);
  else toast.info(notification.message || "You have a new notification.");
}

function notificationPath(notification, role) {
  if (role === "admin" && notification.relatedUserId && !notification.relatedScheduleId) {
    return `/people?user=${notification.relatedUserId}`;
  }
  if (notification.relatedScheduleId) return `/?schedule=${notification.relatedScheduleId}`;
  return "/";
}

export default function NotificationBell({ user }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const initialized = useRef(false);
  const knownIds = useRef(new Set());
  const panelRef = useRef(null);

  async function load({ announce = true } = {}) {
    const [{ notifications: list }, { count }] = await Promise.all([
      api("/notifications?limit=75"),
      api("/notifications/unread-count"),
    ]);
    if (initialized.current && announce) {
      list.filter((item) => !item.isRead && !knownIds.current.has(item.id)).reverse().forEach(showArrival);
    }
    knownIds.current = new Set(list.map((item) => item.id));
    initialized.current = true;
    setNotifications(list);
    setUnread(count);
  }

  useEffect(() => {
    initialized.current = false;
    knownIds.current = new Set();
    load({ announce: false }).catch((error) => toast.error(error.message));
    const timer = window.setInterval(() => load().catch(() => {}), 10000);
    return () => window.clearInterval(timer);
  }, [user.id]);

  useEffect(() => {
    function outside(event) {
      if (open && panelRef.current && !panelRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  async function markRead(notification) {
    if (!notification.isRead) {
      await api(`/notifications/${notification.id}/read`, { method: "PATCH" });
      setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, isRead: true } : item));
      setUnread((count) => Math.max(0, count - 1));
    }
  }

  async function openNotification(notification) {
    try {
      await markRead(notification);
      setOpen(false);
      navigate(notificationPath(notification, user.role));
      window.dispatchEvent(new CustomEvent("anina:open-related", { detail: notification }));
    } catch (error) { toast.error(error.message); }
  }

  async function markAll() {
    try {
      await api("/notifications/read-all", { method: "POST" });
      setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
      setUnread(0);
      toast.success("All notifications marked as read.");
    } catch (error) { toast.error(error.message); }
  }

  return <div className="notification-bell" ref={panelRef}>
    <button className="bell-button" onClick={() => setOpen((value) => !value)} aria-label="Notifications" aria-expanded={open}>
      <span aria-hidden="true">🔔</span>
      {unread > 0 && <span className="bell-badge">{unread > 99 ? "99+" : unread}</span>}
    </button>
    {open && <div className="notification-panel">
      <div className="notification-head">
        <div><strong>Notifications</strong><span>{unread} unread</span></div>
        {unread > 0 && <button onClick={markAll}>Mark all as read</button>}
      </div>
      <div className="notification-list">
        {!notifications.length && <div className="notification-empty">No notifications yet.</div>}
        {notifications.map((notification) => <button
          key={notification.id}
          className={`notification-item${notification.isRead ? "" : " unread"}`}
          onClick={() => openNotification(notification)}
        >
          <span className="notification-dot" />
          <span className="notification-copy">
            <strong>{notification.title}</strong>
            <span>{notification.message}</span>
            <time>{new Date(notification.createdAt).toLocaleString()}</time>
          </span>
          {!notification.isRead && <span className="notification-read" onClick={(event) => {
            event.stopPropagation();
            markRead(notification).catch((error) => toast.error(error.message));
          }}>Mark read</span>}
        </button>)}
      </div>
    </div>}
  </div>;
}
