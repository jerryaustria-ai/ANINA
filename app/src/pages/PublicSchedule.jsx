import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { fmtTime } from "../util.js";
import { useScheduleRefresh } from "../useScheduleRefresh.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mondayOf(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function addDays(value, days) {
  return new Date(value.getTime() + days * DAY_MS);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function duration(startAt, endAt) {
  const minutes = Math.max(0, Math.round((new Date(endAt) - new Date(startAt)) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export default function PublicSchedule() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [state, setState] = useState({ loading: true, error: "" });
  const [reloadKey, setReloadKey] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const firstLoad = useRef(true);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  useEffect(() => {
    let active = true;
    setState({ loading: true, error: "" });
    const query = new URLSearchParams({
      from: weekStart.toISOString(),
      to: weekEnd.toISOString(),
      ...(firstLoad.current ? { includeNearest: "1" } : {}),
    });
    api(`/sessions/public?${query}`)
      .then((data) => {
        if (!active) return;
        if (firstLoad.current && !data.sessions.length && data.nearestStartAt) {
          const nearestWeek = mondayOf(new Date(data.nearestStartAt));
          firstLoad.current = false;
          if (nearestWeek.getTime() !== weekStart.getTime()) {
            setWeekStart(nearestWeek);
            return;
          }
        }
        firstLoad.current = false;
        setSessions(data.sessions);
        setState({ loading: false, error: "" });
      })
      .catch((error) => active && setState({ loading: false, error: error.message }));
    return () => { active = false; };
  }, [weekStart.getTime(), reloadKey]);
  useScheduleRefresh(() => setReloadKey((key) => key + 1));

  function bookingState(session) {
    if (new Date(session.endAt) <= new Date()) return { label: "Closed", button: "Class Finished", disabled: true };
    if (session.availableSlots <= 0) return { label: "Waitlist", button: "Join Waitlist", disabled: false };
    return { label: "Available", button: "Book", disabled: false };
  }

  function continueToBooking(session) {
    if (bookingState(session).disabled) return;
    if (!user) {
      navigate(`/guest/book/${session.id}`);
      return;
    }
    if (user.role === "client") {
      navigate(`/dashboard?schedule=${session.id}`);
      return;
    }
    toast.info("Booking is available to Client accounts.");
  }

  const visibleSessions = sessions.filter((session) => {
    if (availabilityFilter === "available") return session.availableSlots > 0 && new Date(session.endAt) > new Date();
    if (availabilityFilter === "waitlist") return session.availableSlots <= 0 && new Date(session.endAt) > new Date();
    return true;
  });
  const monthLabel = weekStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return <div className="public-schedule-page">
    <header className="public-schedule-nav">
      <Link to="/" className="public-schedule-brand"><img src="/assets/images/anina-logo.png" alt="ANINA Wellness Sanctuary" /></Link>
      <nav aria-label="Public navigation">
        <Link to="/">Home</Link>
        <Link to="/#about">About Us</Link>
        <Link to="/#services">Instructors</Link>
        <Link to="/#services">Packages</Link>
        <Link className="active" to="/schedule">Schedule</Link>
        <Link to="/#contact">Contact Us</Link>
      </nav>
      <div className="public-schedule-auth">
        {user ? <Link className="public-schedule-account" to="/dashboard">Dashboard</Link> :
          <><Link to="/login">Login</Link><Link className="public-schedule-account" to="/register">Register</Link></>}</div>
    </header>

    <section className="public-schedule-hero">
      <span className="botanical botanical-left" aria-hidden="true">⌇</span>
      <div><h1>View Schedule</h1><p>Explore our published classes for this week.</p></div>
      <span className="botanical botanical-right" aria-hidden="true">⌇</span>
    </section>

    <main className="public-schedule-main">
      <div className="public-schedule-toolbar">
        <div className="public-week-controls">
          <button aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
          <strong><span aria-hidden="true">▣</span>{monthLabel}</strong>
          <button aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
        </div>
        <div className="public-filter-wrap">
          <button className="public-filter-button" aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}><span aria-hidden="true">▽</span> Filter</button>
          {filterOpen && <div className="public-filter-menu">
            <label><input type="radio" name="schedule-filter" value="all" checked={availabilityFilter === "all"}
              onChange={() => { setAvailabilityFilter("all"); setFilterOpen(false); }} /> All published</label>
            <label><input type="radio" name="schedule-filter" value="available" checked={availabilityFilter === "available"}
              onChange={() => { setAvailabilityFilter("available"); setFilterOpen(false); }} /> Available spots</label>
            <label><input type="radio" name="schedule-filter" value="waitlist" checked={availabilityFilter === "waitlist"}
              onChange={() => { setAvailabilityFilter("waitlist"); setFilterOpen(false); }} /> Waitlist only</label>
          </div>}
        </div>
      </div>

      {state.error && <div className="public-schedule-state error">
        <strong>We couldn’t load the schedule.</strong><span>{state.error}</span>
        <button onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
      </div>}
      {state.loading && <div className="public-schedule-state"><span className="schedule-loader" />Loading published schedules…</div>}
      {!state.loading && !state.error && <div className="public-week-wrap">
        <div className="public-week-grid">
          {days.map((day) => {
            const daySessions = visibleSessions.filter((session) => sameDay(new Date(session.startAt), day));
            const isToday = sameDay(day, new Date());
            return <section className={`public-day${isToday ? " today" : ""}`} key={day.toISOString()}>
              <header><span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <strong>{day.getDate()}</strong>{isToday && <em>Today</em>}</header>
              <div className="public-day-events">
                {!daySessions.length && <p className="public-no-events">No classes</p>}
                {daySessions.map((session) => {
                  const availability = bookingState(session);
                  return <article className="public-session-card" key={session.id}>
                    <div className="public-session-time">{fmtTime(session.startAt)}</div>
                    <button className="public-session-title" onClick={() => setSelected(session)}>{session.title}</button>
                    <p>{session.instructor.name}</p>
                    <p className="public-duration"><span aria-hidden="true">◷</span> {duration(session.startAt, session.endAt)}</p>
                    <p className={`public-spots${session.availableSlots <= 0 ? " full" : ""}`}>
                      {session.availableSlots} / {session.capacity} spot{session.availableSlots === 1 ? "" : "s"} available
                    </p>
                    <span className={`public-availability ${availability.label.toLowerCase()}`}>{availability.label}</span>
                    <button className="public-book" disabled={availability.disabled}
                      onClick={() => continueToBooking(session)}>{availability.button}</button>
                  </article>;
                })}
              </div>
            </section>;
          })}
        </div>
        {!visibleSessions.length && <div className="public-week-empty">No published schedules are available for this week.</div>}
      </div>}
    </main>

    {!user && <aside className="public-login-prompt">
      <span aria-hidden="true">♙</span>
      <strong>Please log in or create an account to book or join a waitlist.</strong>
      <span>Already have an account? <Link to="/login">Log in</Link></span>
      <i />
      <Link to="/register">Create an account</Link>
    </aside>}

    {selected && <div className="public-detail-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
      <section className="public-detail-modal" role="dialog" aria-modal="true" aria-labelledby="public-session-title"
        onMouseDown={(event) => event.stopPropagation()}>
        <button className="public-detail-close" aria-label="Close details" onClick={() => setSelected(null)}>×</button>
        <p className="landing-kicker">Published session</p>
        <h2 id="public-session-title">{selected.title}</h2>
        <p>{new Date(selected.startAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}<br />
          {fmtTime(selected.startAt)} – {fmtTime(selected.endAt)}</p>
        <dl><div><dt>Instructor</dt><dd>{selected.instructor.name}</dd></div>
          <div><dt>Location</dt><dd>{selected.room?.name || "ANINA Wellness Sanctuary"}</dd></div>
          <div><dt>Duration</dt><dd>{duration(selected.startAt, selected.endAt)}</dd></div>
          <div><dt>Availability</dt><dd>{selected.availableSlots} of {selected.capacity} slots</dd></div></dl>
        <button className="public-book" disabled={bookingState(selected).disabled}
          onClick={() => continueToBooking(selected)}>{bookingState(selected).button}</button>
      </section>
    </div>}
  </div>;
}
