export const pad = (n) => (n < 10 ? "0" + n : "" + n);

// Build a Date from a dateISO (YYYY-MM-DD) + hour, in local time.
export function dateAtHour(dateISO, hour) {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}

// <input type="datetime-local"> value for a Date (local).
export function toLocalInput(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function fmtTime(d) {
  const x = new Date(d);
  let h = x.getHours();
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  const mm = x.getMinutes();
  return `${h}${mm ? ":" + pad(mm) : ""} ${ap}`;
}

export function fmtDay(d) {
  const x = new Date(d);
  return x.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function fmtRange(a, b) {
  return `${fmtDay(a)} · ${fmtTime(a)} – ${fmtTime(b)}`;
}

const CUR = { PHP: "₱", IDR: "Rp", USD: "$" };
export function fmtMoney(amount, currency = "PHP") {
  return (CUR[currency] || "") + Number(amount || 0).toLocaleString();
}

export function fmtInterval(interval, count = 1) {
  const unit = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" }[interval] || "month";
  return count > 1 ? `every ${count} ${unit}s` : `/${unit}`;
}

// Palette for status badges reused in dashboards.
export const STATUS_LABEL = {
  draft: "Draft", open: "Open", confirmed: "Confirmed", cancelled: "Cancelled", completed: "Done",
  pending: "Pending", accepted: "Accepted", waitlisted: "Waitlisted", declined: "Declined",
};
