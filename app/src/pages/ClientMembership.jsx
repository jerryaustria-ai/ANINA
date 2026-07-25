import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { api } from "../api.js";
import { fmtMoney, fmtRange } from "../util.js";

const date = (value) => value
  ? new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium" })
  : "—";
const validity = (plan) => plan
  ? `${plan.intervalCount || 1} ${String(plan.interval || "MONTH").toLowerCase()}${(plan.intervalCount || 1) === 1 ? "" : "s"}`
  : "—";

export default function ClientMembership() {
  const [membership, setMembership] = useState(null);
  const [purchases, setPurchases] = useState([]);

  useEffect(() => {
    Promise.all([api("/memberships/mine"), api("/guest-checkout/history/mine")])
      .then(([plan, history]) => {
        setMembership(plan.membership?.source === "guest_checkout" ? plan.membership : null);
        setPurchases(history.purchases || []);
      })
      .catch((error) => toast.error(error.message));
  }, []);

  const active = membership?.activeNow &&
    (membership.unlimitedClasses || membership.sessionsRemaining == null || membership.sessionsRemaining > 0);

  return <div className="page">
    <div className="page-head"><div><h1>My Class Plans</h1>
      <p>One-time class plan purchases, remaining sessions, and payment history.</p></div>
      <Link className="btn" to="/schedule">Browse Classes</Link></div>

    <h2 style={{ margin: "0 0 .8rem", fontWeight: 300 }}>Current Plan</h2>
    {!active ? <div className="empty">No active class plan. Choose a published class to purchase a plan with a one-time payment.</div> :
      <article className="card" style={{ marginBottom: "1.5rem", borderLeft: "4px solid var(--sage)" }}>
        <div className="purchase-history-head"><div><h3>{membership.tier?.name}</h3>
          <span>{membership.referenceId}</span></div><span className="status-tag accepted">Active</span></div>
        <p className="tier-amount">{fmtMoney(membership.tier?.amount, membership.tier?.currency)}
          <span className="tier-per"> One-Time Payment</span></p>
        <div className="sub">{membership.unlimitedClasses ? "Unlimited sessions"
          : `${membership.sessionsRemaining ?? 0} of ${membership.sessionsIncluded ?? "—"} sessions remaining`}</div>
        <div className="sub">Expires {date(membership.currentPeriodEnd)}</div>
      </article>}

    <h2 style={{ margin: "0 0 .8rem", fontWeight: 300 }}>Purchase History</h2>
    {!purchases.length ? <div className="empty">No successful class plan purchases yet.</div> :
      <div className="grid-cards">{purchases.map((purchase) => <article className="card purchase-history-card" key={purchase.id}>
        <div className="purchase-history-head"><div><h3>{purchase.plan?.name || "Class Plan"}</h3>
          <span>{purchase.referenceId}</span></div>
          <span className={"status-tag " + (purchase.status === "refunded" ? "declined" : "accepted")}>
            {purchase.status === "refunded" ? "Refunded" : "Paid"}</span></div>
        <dl>
          <div><dt>Class</dt><dd>{purchase.session?.title || "—"}</dd></div>
          <div><dt>Schedule</dt><dd>{purchase.session ? fmtRange(purchase.session.startAt, purchase.session.endAt) : "—"}</dd></div>
          <div><dt>Amount</dt><dd>{fmtMoney(purchase.totalAmount, purchase.currency)} One-Time Payment</dd></div>
          <div><dt>Sessions</dt><dd>{purchase.plan?.unlimitedClasses ? "Unlimited" : (purchase.plan?.sessionCount || 1)}</dd></div>
          <div><dt>Validity</dt><dd>{validity(purchase.plan)}</dd></div>
          <div><dt>Payment Method</dt><dd>{purchase.paymentMethod || "Xendit"}</dd></div>
          <div><dt>Payment Date</dt><dd>{date(purchase.paidAt)}</dd></div>
        </dl>
      </article>)}</div>}
  </div>;
}
