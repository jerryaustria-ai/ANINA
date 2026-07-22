import { useMemo } from "react";
import { addDays, isoDate } from "./WeekView.jsx";
import { monthGridStart } from "../useCalendar.js";
import ViewToggle from "./ViewToggle.jsx";
import { fmtTime } from "../util.js";

/* Month grid (6 weeks x 7 days) with event chips per day — the Google-Calendar
   "Month" view. Same event objects as WeekView.
   Props: anchor, events, onEventClick, onDayClick, onPrev/onNext/onToday,
          view, onViewChange */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MAX_CHIPS = 3;

export default function MonthView({ anchor, events = [], onEventClick, onDayClick, onPrev, onNext, onToday, view, onViewChange }) {
  const gridStart = monthGridStart(anchor);
  const month = anchor.getMonth();
  const todayISO = isoDate(new Date());
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);

  const byDay = useMemo(() => {
    const m = {};
    events.forEach((e) => { (m[isoDate(new Date(e.startAt))] ||= []).push(e); });
    Object.values(m).forEach((list) => list.sort((a, b) => new Date(a.startAt) - new Date(b.startAt)));
    return m;
  }, [events]);

  return (
    <div className="wv">
      <div className="wv-toolbar">
        <div className="wv-nav">
          <button className="wv-btn" onClick={onToday}>Today</button>
          <button className="wv-btn wv-icon" onClick={onPrev} aria-label="Previous month">‹</button>
          <button className="wv-btn wv-icon" onClick={onNext} aria-label="Next month">›</button>
        </div>
        <div className="wv-range">{MON[month]} {anchor.getFullYear()}</div>
        {onViewChange && <ViewToggle view={view} onChange={onViewChange} />}
      </div>

      <div className="mv-weekdays">
        {DOW.map((d) => <div key={d} className="mv-weekday">{d}</div>)}
      </div>

      <div className="mv-grid">
        {days.map((d) => {
          const iso = isoDate(d);
          const inMonth = d.getMonth() === month;
          const evs = byDay[iso] || [];
          const shown = evs.slice(0, MAX_CHIPS);
          const extra = evs.length - shown.length;
          return (
            <div
              key={iso}
              className={"mv-cell" + (inMonth ? "" : " is-out") + (iso === todayISO ? " is-today" : "")}
              onClick={() => onDayClick?.(d)}
            >
              <div className="mv-daynum">{d.getDate()}</div>
              <div className="mv-chips">
                {shown.map((e) => (
                  <button
                    key={e.id}
                    className={"mv-chip" + (e.dim ? " is-dim" : "")}
                    style={{ background: e.color || "#6E7F63" }}
                    onClick={(ev) => { ev.stopPropagation(); onEventClick?.(e); }}
                    title={`${fmtTime(e.startAt)} · ${e.title}`}
                  >
                    <span className="mv-chip-time">{fmtTime(e.startAt)}</span> {e.title}
                  </button>
                ))}
                {extra > 0 && (
                  <button className="mv-more" onClick={(ev) => { ev.stopPropagation(); onDayClick?.(d); }}>
                    +{extra} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
