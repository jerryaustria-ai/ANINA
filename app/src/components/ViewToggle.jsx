// Segmented Week / Month switch shared by both calendar views.
export default function ViewToggle({ view, onChange }) {
  return (
    <div className="view-toggle" role="group" aria-label="Calendar view">
      <button className={view === "week" ? "on" : ""} onClick={() => onChange("week")}>Week</button>
      <button className={view === "month" ? "on" : ""} onClick={() => onChange("month")}>Month</button>
    </div>
  );
}
