import { HttpError } from "../utils/http.js";

export const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || "Asia/Manila";
export const UNAVAILABLE_BOOKING_MESSAGE = "This class is no longer available for booking.";

export function dateKeyInTimezone(date, timeZone = APP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isPastLocalDate(date, now = new Date()) {
  return dateKeyInTimezone(new Date(date)) < dateKeyInTimezone(now);
}

export function assertScheduleDateNotPast(date) {
  if (isPastLocalDate(date)) {
    throw new HttpError(400, "Schedules cannot be created for past dates. Please select today or a future date.");
  }
}

export function isScheduleUnavailable(session, now = new Date()) {
  const status = String(session?.status || "").toLowerCase();
  return ["completed", "finished", "cancelled"].includes(status) ||
    isPastLocalDate(session.startAt, now) ||
    new Date(session.endAt) <= now;
}

export function assertScheduleBookable(session) {
  if (isScheduleUnavailable(session)) {
    throw new HttpError(410, UNAVAILABLE_BOOKING_MESSAGE);
  }
  if (!["open", "confirmed", "rescheduled"].includes(session.status)) {
    throw new HttpError(409, "This class is not open for booking.");
  }
}
