import { useEffect, useState } from "react";
import { api } from "../api.js";
import { fmtMoney, fmtInterval } from "../util.js";
import { toast } from "react-toastify";

const STATUS_TEXT = {
  active: "Active", pending: "Awaiting payment", past_due: "Payment failed", cancelled: "Cancelled", inactive: "Inactive",
};

export default function ClientMembership() {
  const [membership, setMembership] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ membership, live }, { tiers }] = await Promise.all([
      api("/memberships/mine"), api("/tiers"),
    ]);
    setMembership(membership);
    if (membership?.status === "past_due") {
      toast.error("Your last payment failed — please update your payment method.", { toastId: "membership-past-due" });
    }
    setLive(live);
    setTiers(tiers);
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
    const p = new URLSearchParams(window.location.search).get("status");
    if (p === "success") toast.success("Thanks! We're confirming your payment — your membership activates shortly.", { toastId: "membership-return-success" });
    if (p === "cancelled") toast.warning("Checkout cancelled. You can subscribe again anytime.", { toastId: "membership-return-cancelled" });
  }, []);

  const activeish = membership && ["active", "pending", "past_due"].includes(membership.status);

  async function subscribe(tierId) {
    setBusy(true);
    try {
      const res = await api("/memberships/subscribe", { method: "POST", body: { tierId } });
      await load();
      toast.success(
        res.checkoutUrl
          ? "Subscription started. Open the secure checkout below; it will stay separate from this page."
          : "Subscription started. Complete payment below to activate."
      );
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function simulatePay() {
    setBusy(true);
    try { await api(`/memberships/${membership.id}/simulate`, { method: "POST", body: { event: "activated" } }); await load();
      toast.success("Payment simulated — membership active. You can now book classes."); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!window.confirm("Cancel your membership? You'll lose booking access.")) return;
    setBusy(true);
    try { await api(`/memberships/${membership.id}/cancel`, { method: "POST" }); await load(); toast.success("Membership cancelled."); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head"><div><h1>Membership</h1><p>An active membership unlocks class booking.</p></div></div>

      {activeish && (
        <div className="card" style={{ marginBottom: "1.4rem", borderLeft: "4px solid var(--sage)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
            <h3>{membership.tier?.name}</h3>
            <span className={"status-tag " + (membership.status === "active" ? "accepted" : membership.status === "past_due" ? "cancelled" : "pending")}>
              {STATUS_TEXT[membership.status]}
            </span>
          </div>
          <div className="sub">{fmtMoney(membership.tier?.amount, membership.tier?.currency)}{fmtInterval(membership.tier?.interval, membership.tier?.intervalCount)}</div>
          {membership.status === "active" && membership.currentPeriodEnd && (
            <div className="sub">Renews {new Date(membership.currentPeriodEnd).toLocaleDateString()}</div>
          )}

          <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.6rem" }}>
            {membership.status === "pending" && membership.simulated &&
              <button className="btn" onClick={simulatePay} disabled={busy}>Complete payment (simulated)</button>}
            {membership.status === "pending" && !membership.simulated && membership.checkoutUrl &&
              <a className="btn" href={membership.checkoutUrl} target="_blank" rel="noopener noreferrer">Open secure checkout</a>}
            <button className="btn danger" onClick={cancel} disabled={busy}>Cancel membership</button>
          </div>
        </div>
      )}

      {!activeish && (
        <>
          {tiers.length === 0
            ? <div className="empty">No membership plans available yet. Please check back soon.</div>
            : <div className="grid-cards">
                {tiers.map((t) => (
                  <div className="card" key={t.id}>
                    <h3>{t.name}</h3>
                    <p className="tier-amount">{fmtMoney(t.amount, t.currency)}<span className="tier-per">{fmtInterval(t.interval, t.intervalCount)}</span></p>
                    {t.description && <div className="sub" style={{ marginBottom: "0.5rem" }}>{t.description}</div>}
                    {t.benefits?.length > 0 && (
                      <ul className="tier-benefits">{t.benefits.map((b, i) => <li key={i}>{b}</li>)}</ul>
                    )}
                    <button className="btn" style={{ marginTop: "0.8rem", width: "100%" }} onClick={() => subscribe(t.id)} disabled={busy}>Subscribe</button>
                  </div>
                ))}
              </div>}
          {!live && <p className="meta-line" style={{ marginTop: "1rem" }}>Billing is in simulation mode — no real charge is made. Connect a Xendit key to go live.</p>}
        </>
      )}
    </div>
  );
}
