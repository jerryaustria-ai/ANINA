import ViewToggle from "./ViewToggle.jsx";
import { fmtRange } from "../util.js";

export default function ListView({
  events = [], onEventClick, onPrev, onNext, onToday, view, onViewChange,
}) {
  const sorted = [...events].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  return <div className="wv list-view">
    <div className="wv-toolbar">
      <div className="wv-nav">
        <button className="wv-btn" onClick={onToday}>Today</button>
        <button className="wv-btn wv-icon" onClick={onPrev} aria-label="Previous week">‹</button>
        <button className="wv-btn wv-icon" onClick={onNext} aria-label="Next week">›</button>
      </div>
      <div className="wv-range">Schedule List</div>
      <ViewToggle view={view} onChange={onViewChange} />
    </div>
    {!sorted.length ? <div className="empty">No available schedules in this period.</div> :
      <div className="schedule-list">{sorted.map((event) => <button key={event.id}
        className={`schedule-list-item${event.dim ? " is-dim" : ""}`}
        onClick={() => onEventClick?.(event)}>
        <span className="schedule-list-color" style={{ background: event.color || "#6E7F63" }} />
        <span><strong>{event.title}</strong><small>{fmtRange(event.startAt, event.endAt)}</small></span>
        <span>{event.sub}</span><em>{event.badge}</em>
      </button>)}</div>}
  </div>;
}
