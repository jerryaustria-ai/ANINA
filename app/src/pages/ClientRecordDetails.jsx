import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { api } from "../api.js";
import { fmtMoney } from "../util.js";

const date = (value, withTime = false) => value
  ? new Date(value).toLocaleString("en-PH", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" })
  : "—";
const sessions = (value, unlimited) => unlimited ? "Unlimited" : (value ?? "—");

export default function ClientRecordDetails() {
  const { clientId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      setData(await api(`/memberships/clients/${clientId}/record`));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }
  useEffect(() => { load(); }, [clientId]);

  async function cancelPlan(plan) {
    if (!window.confirm(`Cancel ${plan.purchasedPlan}? The remaining sessions will no longer be usable.`)) return;
    setBusy(plan.membershipId);
    try {
      await api(`/memberships/${plan.membershipId}/cancel`, { method: "POST" });
      await load();
      toast.success("Class plan cancelled.");
    } catch (requestError) {
      toast.error(requestError.message);
    } finally {
      setBusy("");
    }
  }

  if (error) return <div className="page"><div className="empty">{error}</div></div>;
  if (!data) return <div className="page"><div className="empty">Loading client record…</div></div>;
  const { client, activePlans, history } = data;

  return <div className="page client-record-page">
    <div className="page-head"><div><Link className="back-link" to="/dashboard/memberships">← Class Plan Purchases</Link>
      <h1>{client.name}</h1><p>Complete client, plan, payment, and class history.</p></div></div>

    <section className="record-card">
      <h2>Client Information</h2>
      <dl className="record-grid">
        <div><dt>Full Name</dt><dd>{client.name}</dd></div>
        <div><dt>Email Address</dt><dd>{client.email}</dd></div>
        <div><dt>Phone Number</dt><dd>{client.phone || "—"}</dd></div>
        <div><dt>Account Status</dt><dd>{client.active ? "Active" : "Inactive"}</dd></div>
        <div><dt>Date Created</dt><dd>{date(client.createdAt)}</dd></div>
      </dl>
    </section>

    <section className="record-section">
      <h2>Current Active Plans</h2>
      {!activePlans.length ? <div className="empty">No active class plans.</div> :
        <div className="record-plan-grid">{activePlans.map((plan) => <article className="record-card" key={plan.id}>
          <div className="record-card-head"><div><h3>{plan.purchasedPlan}</h3><p>{plan.className}</p></div>
            <span className="status-tag accepted">{plan.planStatus}</span></div>
          <dl className="record-grid compact">
            <div><dt>Booking Reference</dt><dd>{plan.referenceId}</dd></div>
            <div><dt>One-Time Amount Paid</dt><dd>{fmtMoney(plan.amountPaid, plan.currency)}</dd></div>
            <div><dt>Payment Method</dt><dd>{plan.paymentMethod}</dd></div>
            <div><dt>Payment Date</dt><dd>{date(plan.paymentDate, true)}</dd></div>
            <div><dt>Included Sessions</dt><dd>{sessions(plan.includedSessions, plan.unlimitedClasses)}</dd></div>
            <div><dt>Used Sessions</dt><dd>{sessions(plan.usedSessions, plan.unlimitedClasses)}</dd></div>
            <div><dt>Remaining Sessions</dt><dd>{sessions(plan.remainingSessions, plan.unlimitedClasses)}</dd></div>
            <div><dt>Start Date</dt><dd>{date(plan.startDate)}</dd></div>
            <div><dt>Expiration Date</dt><dd>{date(plan.expirationDate)}</dd></div>
          </dl>
          <button className="btn danger sm" disabled={busy === plan.membershipId}
            onClick={() => cancelPlan(plan)}>Cancel Plan</button>
        </article>)}</div>}
    </section>

    <section className="record-section">
      <h2>Class and Booking History</h2>
      {!history.length ? <div className="empty">No successful booking history.</div> :
        <div className="purchase-table-wrap"><table className="purchase-table">
          <thead><tr><th>Class</th><th>Instructor / Schedule</th><th>Plan / Reference</th>
            <th>Attendance</th><th>Payment</th><th>Amount</th><th>Booked</th><th>Expires</th><th>Status</th></tr></thead>
          <tbody>{history.map((record) => <tr key={record.id}>
            <td>{record.className}</td>
            <td>{record.session?.instructor?.name || "—"}<small>{date(record.session?.startAt, true)}</small></td>
            <td>{record.purchasedPlan}<small>{record.referenceId}</small></td>
            <td>{record.attendanceStatus}</td><td>{record.paymentStatus}</td>
            <td>{fmtMoney(record.amountPaid, record.currency)}</td>
            <td>{date(record.bookingDate)}</td><td>{date(record.expirationDate)}</td>
            <td><span className="status-tag accepted">{record.planStatus}</span></td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </div>;
}
