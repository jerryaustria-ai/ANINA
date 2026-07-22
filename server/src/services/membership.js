import { Membership } from "../models/Membership.js";

// Advance a period-end by the tier's interval.
function extend(from, interval, count) {
  const d = new Date(from);
  const n = count || 1;
  if (interval === "DAY") d.setDate(d.getDate() + n);
  else if (interval === "WEEK") d.setDate(d.getDate() + 7 * n);
  else if (interval === "YEAR") d.setFullYear(d.getFullYear() + n);
  else d.setMonth(d.getMonth() + n); // MONTH default
  return d;
}

// Normalised event names → the transition they cause. Both the Xendit webhook
// route and the dev simulator funnel through applyEvent so behaviour matches.
export const EVENTS = ["activated", "cycle_succeeded", "cycle_failed", "inactivated", "cancelled"];

// Map a raw Xendit webhook `event` string to our normalised event.
export function normalizeEvent(raw = "") {
  const e = raw.toLowerCase();
  if (e.includes("plan.activation") || e.includes("plan.activated")) return "activated";
  if (e.includes("cycle.succeeded")) return "cycle_succeeded";
  if (e.includes("cycle.failed")) return "cycle_failed";
  if (e.includes("plan.inactivated") || e.includes("plan.deactivated")) return "inactivated";
  if (e.includes("cancel")) return "cancelled";
  return null;
}

// Apply an event to a membership (tier is populated on `membership.tier`).
export async function applyEvent(membership, event) {
  const tier = membership.tier;
  const interval = tier?.interval || "MONTH";
  const count = tier?.intervalCount || 1;
  const now = new Date();

  switch (event) {
    case "activated":
    case "cycle_succeeded": {
      membership.status = "active";
      const base = membership.currentPeriodEnd && membership.currentPeriodEnd > now ? membership.currentPeriodEnd : now;
      membership.currentPeriodEnd = extend(base, interval, count);
      membership.cycleCount += 1;
      break;
    }
    case "cycle_failed":
      membership.status = "past_due";
      break;
    case "inactivated":
      membership.status = "inactive";
      break;
    case "cancelled":
      membership.status = "cancelled";
      break;
    default:
      return membership; // unknown event: no-op
  }
  membership.lastEvent = event;
  await membership.save();
  return membership;
}

// Does this client currently have an active, in-period membership?
export async function hasActiveMembership(clientId) {
  const m = await Membership.findOne({ client: clientId, status: "active" });
  return !!(m && m.isActiveNow());
}
