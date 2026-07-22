import { useEffect, useState } from "react";
import { api } from "../api.js";
import { fmtMoney, fmtInterval } from "../util.js";

const STATUS_TEXT = {
  active: "Active", pending: "Awaiting payment", past_due: "Payment failed", cancelled: "Cancelled", inactive: "Inactive",
};

export default function ClientMembership() {
  const [membership, setMembership] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [live, setLive] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ membership, live }, { tiers }] = await Promise.all([
      api("/memberships/mine"), api("/tiers"),
    ]);
    setMembership(membership);
    setLive(live);
    setTiers(tiers);
  }
  useEffect(() => {
    load().catch((e) => setMsg({ kind: "err", text: e.message }));
    const p = new URLSearchParams(window.location.search).get("status");
    if (p === "success") setMsg({ kind: "ok", text: "Thanks! We're confirming your payment — your membership activates shortly." });
    if (p === "cancelled") setMsg({ kind: "warn", text: "Checkout cancelled. You can subscribe again anytime." });
  }, []);

  const activeish = membership && ["active", "pending", "past_due"].includes(membership.status);

  async function subscribe(tierId) {
    setBusy(true); setMsg(null);
    try {
      const res = await api("/memberships/subscribe", { method: "POST", body: { tierId } });
      if (res.checkoutUrl) { window.location.href = res.checkoutUrl; return; } // live: go to Xendit
      await load();
      setMsg({ kind: "ok", text: "Subscription started. Complete payment below to activate." });
    } catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  async function simulatePay() {
    setBusy(true); setMsg(null);
    try { await api(`/memberships/${membership.id}/simulate`, { method: "POST", body: { event: "activated" } }); await load();
      setMsg({ kind: "ok", text: "Payment simulated — membership active. You can now book classes." }); }
    catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!window.confirm("Cancel your membership? You'll lose booking access.")) return;
    setBusy(true); setMsg(null);
    try { await api(`/memberships/${membership.id}/cancel`, { method: "POST" }); await load(); }
    catch (e) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head"><div><h1>Membership</h1><p>An active membership unlocks class booking.</p></div></div>
      {msg && <div className={"banner " + msg.kind}>{msg.text}</div>}

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
          {membership.status === "past_due" && <div className="banner err" style={{ marginTop: "0.7rem" }}>Your last payment failed — please update your payment method.</div>}

          <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.6rem" }}>
            {membership.status === "pending" && membership.simulated &&
              <button className="btn" onClick={simulatePay} disabled={busy}>Complete payment (simulated)</button>}
            {membership.status === "pending" && !membership.simulated && membership.checkoutUrl &&
              <a className="btn" href={membership.checkoutUrl}>Continue to checkout</a>}
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
