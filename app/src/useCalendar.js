import { useMemo, useState } from "react";
import { mondayOf, addDays } from "./components/WeekView.jsx";

// First Monday of the 6-week grid that shows the anchor's month.
export function monthGridStart(anchor) {
  return mondayOf(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
}
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

// Central calendar state shared by every dashboard: view (week|month),
// the anchor date, the data-fetch range, and navigation handlers.
export function useCalendar(initialView = "week") {
  const [view, setView] = useState(initialView);
  const [anchor, setAnchor] = useState(() => new Date());

  const weekStart = useMemo(() => mondayOf(anchor), [anchor]);

  // The [from, to) window to fetch sessions for the visible view.
  const range = useMemo(() => {
    if (view === "week") return { from: weekStart, to: addDays(weekStart, 7) };
    const gridStart = monthGridStart(anchor);
    return { from: gridStart, to: addDays(gridStart, 42) };
  }, [view, weekStart, anchor]);

  const prev = () => setAnchor((a) => (view === "week" ? addDays(a, -7) : addMonths(a, -1)));
  const next = () => setAnchor((a) => (view === "week" ? addDays(a, 7) : addMonths(a, 1)));
  const today = () => setAnchor(new Date());

  // Jump to a specific day in week view (used when clicking a day in month view).
  const goToDay = (date) => { setAnchor(new Date(date)); setView("week"); };

  return { view, setView, anchor, weekStart, range, prev, next, today, goToDay };
}
