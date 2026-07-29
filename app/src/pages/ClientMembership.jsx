import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { api } from "../api.js";
import { fmtInterval, fmtMoney, fmtRange } from "../util.js";

const date = (value) => value
  ? new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium" })
  : "—";
const validity = (plan) => plan
  ? `${plan.intervalCount || 1} ${String(plan.interval || "MONTH").toLowerCase()}${(plan.intervalCount || 1) === 1 ? "" : "s"}`
  : "—";

export default function ClientMembership() {
  const [membership, setMembership] = useState(null);
  const [recurring, setRecurring] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [plan, history, tierData] = await Promise.all([
      api("/memberships/mine"), api("/guest-checkout/history/mine"), api("/tiers"),
    ]);
    setMembership((plan.memberships || []).find((item) => item.source === "guest_checkout" && item.activeNow) || null);
    setRecurring((plan.memberships || []).find((item) =>
      item.source === "membership" && ["active", "pending", "past_due"].includes(item.status)) || null);
    setPurchases(history.purchases || []);
    setTiers(tierData.tiers || []);
  }
  useEffect(() => { load().catch((error) => toast.error(error.message)); }, []);

  const active = membership?.activeNow;

  async function subscribe(tierId) {
    setBusy(true);
    try {
      const result = await api("/memberships/subscribe", { method: "POST", body: { tierId } });
      await load();
      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
      else toast.info("Recurring subscription created in simulation mode.");
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  async function cancelRecurring() {
    if (!window.confirm("Cancel this recurring subscription? Future renewals will stop according to the cancellation policy.")) return;
    setBusy(true);
    try {
      await api(`/memberships/${recurring.id}/cancel`, { method: "POST" });
      await load();
      toast.success("Recurring subscription cancelled.");
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="page-head"><div><h1>My Memberships</h1>
      <p>One-time class plans and recurring subscriptions in one place.</p></div>
      <Link className="btn" to="/schedule">Browse Classes</Link></div>

    <h2 style={{ margin: "0 0 .8rem", fontWeight: 300 }}>Current Plan</h2>
    {!active ? <div className="empty">No active class plan. Choose a published class to purchase a plan with a one-time payment.</div> :
      <article className="card" style={{ marginBottom: "1.5rem", borderLeft: "4px solid var(--sage)" }}>
        <div className="purchase-history-head"><div><h3>{membership.tier?.name}</h3>
          <span>{membership.referenceId}</span></div><span className="status-tag accepted">Active</span></div>
        <p className="tier-amount">{fmtMoney(membership.tier?.amount, membership.tier?.currency)}
          <span className="tier-per"> One-Time Payment</span></p>
        <div className="sub">Expires {date(membership.currentPeriodEnd)}</div>
      </article>}

    <h2 style={{ margin: "1.5rem 0 .8rem", fontWeight: 300 }}>Recurring Subscription</h2>
    {recurring ? <article className="card" style={{ marginBottom: "1.5rem" }}>
      <div className="purchase-history-head"><div><h3>{recurring.tier?.name}</h3><span>{recurring.referenceId}</span></div>
        <span className={"status-tag " + (recurring.status === "active" ? "accepted" : "pending")}>{recurring.status}</span></div>
      <p className="tier-amount">{fmtMoney(recurring.tier?.amount, recurring.tier?.currency)}
        <span className="tier-per">{fmtInterval(recurring.tier?.interval, recurring.tier?.intervalCount)}</span></p>
      <div className="sub">Billing cycle: every {recurring.tier?.intervalCount || 1} {String(recurring.tier?.interval || "month").toLowerCase()}</div>
      <div className="sub">Next billing date: {date(recurring.currentPeriodEnd)}</div>
      <button className="btn danger sm" style={{ marginTop: ".8rem" }} disabled={busy} onClick={cancelRecurring}>Cancel Subscription</button>
    </article> : <div className="grid-cards" style={{ marginBottom: "1.5rem" }}>
      {tiers.map((tier) => <article className="card" key={tier.id}><h3>{tier.name}</h3>
        <p className="tier-amount">{fmtMoney(tier.amount, tier.currency)}
          <span className="tier-per">{fmtInterval(tier.interval, tier.intervalCount)}</span></p>
        <div className="sub">Recurring billing every {tier.intervalCount || 1} {String(tier.interval).toLowerCase()}</div>
        <button className="btn" style={{ marginTop: ".8rem", width: "100%" }} disabled={busy}
          onClick={() => subscribe(tier.id)}>Start Recurring Subscription</button>
      </article>)}
    </div>}

    <h2 style={{ margin: "0 0 .8rem", fontWeight: 300 }}>Purchase History</h2>
    {!purchases.length ? <div className="empty">No class plan purchases or cash enrollments yet.</div> :
      <div className="grid-cards">{purchases.map((purchase) => <article className="card purchase-history-card" key={purchase.id}>
        <div className="purchase-history-head"><div><h3>{purchase.plan?.name || "Class Plan"}</h3>
          <span>{purchase.referenceId}</span></div>
          <span className={"status-tag " + (purchase.status === "refunded" ? "declined"
            : purchase.status === "pending_cash_payment" ? "pending" : "accepted")}>
            {purchase.status === "refunded" ? "Refunded"
              : purchase.status === "pending_cash_payment" ? "Pending Cash Payment" : "Paid"}</span></div>
        <dl>
          <div><dt>Class</dt><dd>{purchase.session?.title || "—"}</dd></div>
          <div><dt>Schedule</dt><dd>{purchase.session ? fmtRange(purchase.session.startAt, purchase.session.endAt) : "—"}</dd></div>
          <div><dt>Amount</dt><dd>{fmtMoney(purchase.totalAmount, purchase.currency)} One-Time Payment</dd></div>
          <div><dt>Validity</dt><dd>{validity(purchase.plan)}</dd></div>
          <div><dt>Payment Method</dt><dd>{purchase.paymentMethod || "Xendit"}</dd></div>
          <div><dt>Payment Date</dt><dd>{date(purchase.paidAt)}</dd></div>
        </dl>
      </article>)}</div>}
  </div>;
}
