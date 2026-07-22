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
  const data = await call("/customers", {
    body: {
      reference_id: "user_" + user._id,
      type: "INDIVIDUAL",
      email: user.email,
      individual_detail: { given_names: user.name || user.email },
    },
  });
  return { id: data.id };
}

// Create a fixed-amount recurring subscription via a hosted Payment Session.
// Returns { planId, checkoutUrl, status }.
export async function createSubscription({ referenceId, customerId, tier, successUrl, cancelUrl }) {
  if (!isLive()) {
    return { planId: "sim_plan_" + referenceId, checkoutUrl: "", status: "PENDING", simulated: true };
  }
  const data = await call("/sessions", {
    body: {
      reference_id: referenceId,
      customer_id: customerId,
      session_type: "SUBSCRIPTION",
      mode: "PAYMENT_LINK",
      currency: tier.currency,
      amount: tier.amount,
      country: "PH",
      subscription: {
        recurring_interval: tier.interval,
        recurring_interval_count: tier.intervalCount,
        immediate_payment: true,
      },
      success_return_url: successUrl,
      cancel_return_url: cancelUrl,
    },
  });
  return {
    planId: data.plan_id || data.id,
    checkoutUrl: data.payment_link_url || (data.actions && data.actions[0]?.url) || "",
    status: data.status || "PENDING",
  };
}

// Cancel/deactivate a recurring plan.
export async function cancelSubscription(planId) {
  if (!isLive() || !planId || planId.startsWith("sim_")) return { ok: true, simulated: true };
  await call(`/recurring/plans/${planId}/deactivate`, { method: "POST" });
  return { ok: true };
}
