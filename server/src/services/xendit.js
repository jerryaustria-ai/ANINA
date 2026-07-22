/* Xendit subscriptions integration.

   When XENDIT_SECRET_KEY is set we talk to the real Xendit API (use a
   development/test key, e.g. xnd_development_...). When it's empty we run in
   SIMULATION mode: no external calls, fake ids, and the client "completes"
   payment via a local dev endpoint. This lets us build & test the whole flow
   before a Xendit account exists.

   Docs: https://docs.xendit.co/recurring/fixed-amount-subscription
   NOTE: exact request field names can vary by account configuration — they are
   centralised here so they're easy to reconcile against your Xendit dashboard.
*/

const SECRET = process.env.XENDIT_SECRET_KEY || "";
const BASE = process.env.XENDIT_API_BASE || "https://api.xendit.co";
const SIMULATION = process.env.XENDIT_SIMULATION === "true";

export const isLive = () => !!SECRET && !SIMULATION;

function authHeader() {
  // Xendit uses HTTP Basic auth: secret key as username, empty password.
  return "Basic " + Buffer.from(SECRET + ":").toString("base64");
}

async function call(path, { method = "POST", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error_code || `Xendit error (${res.status})`);
    err.status = 502;
    err.xendit = data;
    throw err;
  }
  return data;
}

// Ensure a Xendit customer exists for this user; returns the customer id.
export async function createCustomer(user) {
  if (!isLive()) return { id: "sim_cust_" + user._id };
  const referenceId = "user_" + user._id;

  // Xendit requires customer reference_id to be unique. Reuse the customer
  // created by an earlier subscription attempt instead of POSTing it again.
  const findExisting = async () => {
    const result = await call(`/customers?reference_id=${encodeURIComponent(referenceId)}`, { method: "GET" });
    return result.data?.[0] || (Array.isArray(result) ? result[0] : null);
  };
  const existing = await findExisting();
  if (existing?.id) return { id: existing.id };

  try {
    const data = await call("/customers", {
      body: {
        reference_id: referenceId,
        type: "INDIVIDUAL",
        email: user.email,
        individual_detail: { given_names: user.name || user.email },
      },
    });
    return { id: data.id };
  } catch (error) {
    // Handles two simultaneous first-time subscribe requests safely.
    if (error.xendit?.error_code !== "DUPLICATE_ERROR") throw error;
    const duplicate = await findExisting();
    if (!duplicate?.id) throw error;
    return { id: duplicate.id };
  }
}

// Create a fixed-amount recurring subscription via a hosted Payment Session.
// Returns { planId, checkoutUrl, status }.
export async function createSubscription({ referenceId, customerId, tier, successUrl, cancelUrl }) {
  if (!isLive()) {
    return { planId: "sim_plan_" + referenceId, checkoutUrl: "", status: "PENDING", simulated: true };
  }
  const interval = tier.interval === "YEAR" ? "MONTH" : tier.interval;
  const intervalCount = tier.interval === "YEAR" ? tier.intervalCount * 12 : tier.intervalCount;
  const now = Date.now();
  const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();
  const anchorDate = new Date(now + 16 * 60 * 1000).toISOString();
  const data = await call("/sessions", {
    body: {
      reference_id: referenceId,
      customer_id: customerId,
      session_type: "SUBSCRIPTION",
      mode: "PAYMENT_LINK",
      currency: tier.currency,
      amount: tier.amount,
      country: "PH",
      expires_at: expiresAt,
      subscription: {
        schedule: {
          interval,
          interval_count: intervalCount,
          anchor_date: anchorDate,
          retry_interval: "DAY",
          retry_interval_count: 1,
          total_retry: 3,
          failed_attempt_notifications: [1, 2, 3],
        },
        failed_cycle_action: "STOP",
      },
      success_return_url: successUrl,
      cancel_return_url: cancelUrl,
    },
  });
  return {
    planId: data.plan_id || data.payment_session_id || data.id,
    checkoutUrl: data.payment_link_url || (data.actions && data.actions[0]?.url) || "",
    status: data.status || "PENDING",
  };
}

// Cancel a pending Payment Session, or deactivate a created recurring plan.
export async function cancelSubscription(remoteId) {
  if (!isLive() || !remoteId || remoteId.startsWith("sim_")) return { ok: true, simulated: true };
  if (remoteId.startsWith("ps-")) {
    await call(`/sessions/${encodeURIComponent(remoteId)}/cancel`, { method: "POST" });
    return { ok: true, type: "session" };
  }
  await call(`/recurring/plans/${encodeURIComponent(remoteId)}/deactivate`, { method: "POST" });
  return { ok: true };
}
