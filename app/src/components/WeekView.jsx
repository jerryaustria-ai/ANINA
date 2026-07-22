import { useMemo, useRef, useState } from "react";
import ViewToggle from "./ViewToggle.jsx";

/* Google-Calendar-style weekly grid, ported from the marketing site's booking
   calendar. Renders a time gutter + 7 day columns with absolutely-positioned
   event blocks. Optionally supports drag-to-create on empty slots.

   Props:
     weekStart    Date (Monday 00:00) of the week to show
     events       [{ id, title, startAt, endAt, color, sub, badge, dim }]
     firstHour    default 6
     lastHour     default 21
     onEventClick (event) => void
     onSlotSelect ({ dateISO, startHour, endHour }) => void   // enables drag-create
     onPrev/onNext/onToday, rangeLabel, canPrev
*/

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ROW = 46; // px per hour

const pad = (n) => (n < 10 ? "0" + n : "" + n);
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hourLabel = (h) => { const ap = h < 12 ? "AM" : "PM"; let hh = h % 12; if (hh === 0) hh = 12; return `${hh} ${ap}`; };
const frac = (d) => d.getHours() + d.getMinutes() / 60;

// Side-by-side layout for overlapping events within a single day.
function layoutDay(evs) {
  const sorted = [...evs].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const placed = [];
  let cluster = [];
  let clusterEnd = 0;
  const flush = () => {
    // assign columns within the cluster
    const cols = [];
    cluster.forEach((e) => {
      let ci = cols.findIndex((end) => new Date(e.startAt) >= end);
      if (ci === -1) { ci = cols.length; cols.push(new Date(e.endAt)); }
      else cols[ci] = new Date(e.endAt);
      e._col = ci;
    });
    const count = cols.length;
    cluster.forEach((e) => { e._colCount = count; placed.push(e); });
    cluster = [];
  };
  sorted.forEach((e) => {
    const s = new Date(e.startAt).getTime();
    if (cluster.length && s >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, new Date(e.endAt).getTime());
  });
  if (cluster.length) flush();
  return placed;
}

export default function WeekView({
  weekStart, events = [], firstHour = 6, lastHour = 21,
  onEventClick, onSlotSelect, onPrev, onNext, onToday, rangeLabel, canPrev = true,
  view, onViewChange,
}) {
  const bodyRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const hours = [];
  for (let h = firstHour; h < lastHour; h++) hours.push(h);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const todayISO = isoDate(new Date());
  const nowFrac = frac(new Date());

  // Group events by day ISO for layout.
  const byDay = useMemo(() => {
    const m = {};
    events.forEach((e) => {
      const d = new Date(e.startAt);
      const key = isoDate(d);
      (m[key] ||= []).push(e);
    });
    Object.keys(m).forEach((k) => { m[k] = layoutDay(m[k]); });
    return m;
  }, [events]);

  const label = rangeLabel || (() => {
    const s = days[0], e = days[6];
    const sameMonth = s.getMonth() === e.getMonth();
    return `${MON[s.getMonth()]} ${s.getDate()} – ${sameMonth ? "" : MON[e.getMonth()] + " "}${e.getDate()}, ${e.getFullYear()}`;
  })();

  // ---- drag-to-create ----
  function cellHourFromEvent(e, dayISO) {
    const col = bodyRef.current?.querySelector(`[data-col-date="${dayISO}"]`);
    if (!col) return null;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top;
    return firstHour + Math.floor(y / ROW);
  }
  function onColDown(e, dayISO) {
    if (!onSlotSelect) return;
    if (e.target.closest(".wv-event")) return; // let event clicks through
    const h = cellHourFromEvent(e, dayISO);
    if (h == null || h < firstHour || h >= lastHour) return;
    setDrag({ dayISO, startHour: h, curHour: h });
    e.preventDefault();
  }
  function onColMove(e, dayISO) {
    if (!drag || drag.dayISO !== dayISO) return;
    const h = cellHourFromEvent(e, dayISO);
    if (h != null) setDrag((d) => ({ ...d, curHour: Math.max(firstHour, Math.min(lastHour - 1, h)) }));
  }
  function onColUp() {
    if (!drag) return;
    const s = Math.min(drag.startHour, drag.curHour);
    const en = Math.max(drag.startHour, drag.curHour) + 1;
    onSlotSelect?.({ dateISO: drag.dayISO, startHour: s, endHour: en });
    setDrag(null);
  }

  return (
    <div className="wv">
      <div className="wv-toolbar">
        <div className="wv-nav">
          <button className="wv-btn" onClick={onToday}>Today</button>
          <button className="wv-btn wv-icon" onClick={onPrev} disabled={!canPrev} aria-label="Previous week">‹</button>
          <button className="wv-btn wv-icon" onClick={onNext} aria-label="Next week">›</button>
        </div>
        <div className="wv-range">{label}</div>
        {onViewChange && <ViewToggle view={view} onChange={onViewChange} />}
      </div>

      <div className="wv-head">
        <div className="wv-corner" />
        {days.map((d) => {
          const today = isoDate(d) === todayISO;
          return (
            <div key={isoDate(d)} className={"wv-dayhead" + (today ? " is-today" : "")}>
              <div className="wv-dow">{DOW[(d.getDay() + 6) % 7]}</div>
              <div className="wv-dnum">{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      <div className="wv-body" ref={bodyRef} onPointerUp={onColUp} onPointerLeave={onColUp}>
        <div className="wv-gutter">
          {hours.map((h) => <div key={h} className="wv-hourlabel" style={{ height: ROW }}>{hourLabel(h)}</div>)}
        </div>
        {days.map((d) => {
          const dayISO = isoDate(d);
          const today = dayISO === todayISO;
          const evs = byDay[dayISO] || [];
          return (
            <div
              key={dayISO}
              className={"wv-col" + (today ? " is-today" : "")}
              data-col-date={dayISO}
              style={{ height: (lastHour - firstHour) * ROW }}
              onPointerDown={(e) => onColDown(e, dayISO)}
              onPointerMove={(e) => onColMove(e, dayISO)}
            >
              {hours.map((h) => <div key={h} className="wv-cell" style={{ height: ROW }} />)}

              {today && nowFrac >= firstHour && nowFrac <= lastHour && (
                <div className="wv-now" style={{ top: (nowFrac - firstHour) * ROW }} />
              )}

              {drag && drag.dayISO === dayISO && (() => {
                const s = Math.min(drag.startHour, drag.curHour);
                const en = Math.max(drag.startHour, drag.curHour) + 1;
                return <div className="wv-prov" style={{ top: (s - firstHour) * ROW + 1, height: (en - s) * ROW - 2 }}>
                  {hourLabel(s)} – {hourLabel(en)}
                </div>;
              })()}

              {evs.map((e) => {
                const s = frac(new Date(e.startAt));
                const en = frac(new Date(e.endAt));
                const top = (s - firstHour) * ROW + 1;
                const height = Math.max(22, (en - s) * ROW - 2);
                const width = 100 / (e._colCount || 1);
                const left = (e._col || 0) * width;
                return (
                  <div
                    key={e.id}
                    className={"wv-event" + (e.dim ? " is-dim" : "")}
                    style={{ top, height, left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)`,
                             background: e.color || "#6E7F63" }}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={() => onEventClick?.(e)}
                    title={e.title}
                  >
                    <div className="wv-event-title">{e.title}</div>
                    {e.sub && <div className="wv-event-sub">{e.sub}</div>}
                    {e.badge && <div className="wv-event-badge">{e.badge}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Helpers other components reuse.
export function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7;
  return addDays(x, -wd);
}
export { addDays, isoDate };
