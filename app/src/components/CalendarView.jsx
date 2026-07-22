import WeekView, { mondayOf } from "./WeekView.jsx";
import MonthView from "./MonthView.jsx";

/* Renders the active calendar view (week or month) from a useCalendar() state
   object, so dashboards don't repeat the branching. Week view also supports
   drag-to-create via onSlotSelect; month view routes day clicks to week view. */
export default function CalendarView({ cal, events, onEventClick, onSlotSelect, firstHour, lastHour }) {
  const shared = {
    events,
    onEventClick,
    onPrev: cal.prev,
    onNext: cal.next,
    onToday: cal.today,
    view: cal.view,
    onViewChange: cal.setView,
  };

  if (cal.view === "month") {
    return <MonthView anchor={cal.anchor} onDayClick={cal.goToDay} {...shared} />;
  }
  return (
    <WeekView
      weekStart={cal.weekStart}
      firstHour={firstHour}
      lastHour={lastHour}
      onSlotSelect={onSlotSelect}
      canPrev={cal.weekStart > mondayOf(new Date())}
      {...shared}
    />
  );
}
