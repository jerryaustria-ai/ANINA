import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { api } from "../api.js";
import Modal from "../components/Modal.jsx";

const blankPromo = {
  code: "", description: "", discountType: "percentage", discountValue: "",
  minimumPurchaseAmount: "", startAt: "", expiresAt: "", totalUsageLimit: "",
  usageLimitPerClient: "", applicableTo: "all", applicableClassIds: [],
  applicableTierIds: [], applicablePaymentMethod: "all", status: "draft",
};
const money = (value) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
const date = (value) => value ? new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium" }) : "—";
const label = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const inputDate = (value) => value ? new Date(value).toISOString().slice(0, 10) : "";

export default function PromoCodes() {
  const [promoCodes, setPromoCodes] = useState([]);
  const [classes, setClasses] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [edit, setEdit] = useState(null);
  const [detail, setDetail] = useState(null);
  const [remove, setRemove] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [promoData, classData, tierData] = await Promise.all([
        api("/promo-codes"),
        api("/class-definitions?all=1"),
        api("/tiers?all=1"),
      ]);
      setPromoCodes(promoData.promoCodes || []);
      setClasses(classData.classDefinitions || classData.classes || []);
      setTiers(tierData.tiers || []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const selectedNames = useMemo(() => {
    if (!detail) return [];
    if (detail.applicableTo === "specific_classes") {
      return detail.applicableClasses?.map((item) => item.title) || [];
    }
    if (["specific_plans", "specific_packages"].includes(detail.applicableTo)) {
      return detail.applicablePlans?.map((item) => item.name) || [];
    }
    return [];
  }, [detail]);

  function openEdit(promo = null) {
    setEdit(promo ? {
      ...promo,
      startAt: inputDate(promo.startAt),
      expiresAt: inputDate(promo.expiresAt),
      totalUsageLimit: promo.totalUsageLimit || "",
      usageLimitPerClient: promo.usageLimitPerClient || "",
      applicableClassIds: (promo.applicableClassIds || []).map(String),
      applicableTierIds: (promo.applicableTierIds || []).map(String),
      status: promo.configuredStatus || promo.status,
    } : { ...blankPromo });
  }
  function toggleId(field, id) {
    setEdit((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((value) => value !== id)
        : [...current[field], id],
    }));
  }
  async function save() {
    setBusy(true);
    try {
      const path = edit.id ? `/promo-codes/${edit.id}` : "/promo-codes";
      const result = await api(path, { method: edit.id ? "PATCH" : "POST", body: edit });
      toast.success(edit.id ? "Promo code updated successfully." : "Promo code created successfully.");
      setEdit(null);
      await load();
      return result;
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function setActive(promo, active) {
    setBusy(true);
    try {
      await api(`/promo-codes/${promo.id}/status`, { method: "POST", body: { active } });
      toast.success(active ? "Promo code activated." : "Promo code deactivated.");
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function confirmDelete() {
    setBusy(true);
    try {
      await api(`/promo-codes/${remove.id}`, { method: "DELETE" });
      toast.success("Promo code deleted successfully.");
      setRemove(null);
      await load();
    } catch (error) {
      toast.warning(error.message);
      setRemove(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return <div className="page promo-page">
    <div className="page-head">
      <div><p className="settings-breadcrumb">Settings / Promo Codes</p>
        <h1>Promo Codes</h1><p>Create, scope, activate, and monitor checkout discounts.</p></div>
      <button className="btn" onClick={() => openEdit()}>Create Promo Code</button>
    </div>
    {loading ? <div className="spinner">Loading promo codes…</div>
      : !promoCodes.length ? <div className="empty">No promo codes yet.</div>
        : <div className="purchase-table-wrap"><table className="purchase-table promo-table">
          <thead><tr><th>Promo Code</th><th>Description</th><th>Discount</th><th>Applicable To</th>
            <th>Dates</th><th>Usage</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{promoCodes.map((promo) => <tr key={promo.id}>
            <td data-label="Promo Code"><strong>{promo.code}</strong></td>
            <td data-label="Description">{promo.description || "—"}</td>
            <td data-label="Discount">{promo.discountType === "percentage"
              ? `${promo.discountValue}%` : money(promo.discountValue)}</td>
            <td data-label="Applicable To">{label(promo.applicableTo)}
              <small>{label(promo.applicablePaymentMethod)} payment</small></td>
            <td data-label="Dates">{date(promo.startAt)}<small>to {date(promo.expiresAt)}</small></td>
            <td data-label="Usage">{promo.usageCount} / {promo.totalUsageLimit || "Unlimited"}
              <small>{promo.usageLimitPerClient || "Unlimited"} per client</small></td>
            <td data-label="Status"><span className={`status-tag ${promo.status === "active" ? "accepted"
              : ["expired", "usage_limit_reached"].includes(promo.status) ? "cancelled" : "pending"}`}>
              {label(promo.status)}</span></td>
            <td data-label="Actions"><div className="table-actions">
              <button className="btn ghost sm" onClick={() => setDetail(promo)}>View Details</button>
              <button className="btn ghost sm" onClick={() => openEdit(promo)}>Edit</button>
              {promo.configuredStatus === "active"
                ? <button className="btn ghost sm" disabled={busy} onClick={() => setActive(promo, false)}>Deactivate</button>
                : <button className="btn ghost sm" disabled={busy} onClick={() => setActive(promo, true)}>Activate</button>}
              <button className="btn danger sm" disabled={busy} onClick={() => setRemove(promo)}>Delete</button>
            </div></td>
          </tr>)}</tbody>
        </table></div>}

    <Modal open={!!edit} onClose={() => !busy && setEdit(null)}
      title={edit?.id ? "Edit Promo Code" : "Create Promo Code"}
      footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Promo Code"}</button></>}>
      {edit && <div className="form-grid promo-form">
        <div className="field"><label>Promo Code *</label><input value={edit.code}
          onChange={(event) => setEdit({ ...edit, code: event.target.value.toUpperCase().trimStart() })} /></div>
        <div className="field"><label>Status</label><select value={edit.status}
          onChange={(event) => setEdit({ ...edit, status: event.target.value })}>
          <option value="draft">Draft</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select></div>
        <div className="field span-2"><label>Description</label><textarea rows="3" value={edit.description}
          onChange={(event) => setEdit({ ...edit, description: event.target.value })} /></div>
        <div className="field"><label>Discount Type *</label><select value={edit.discountType}
          onChange={(event) => setEdit({ ...edit, discountType: event.target.value })}>
          <option value="percentage">Percentage</option><option value="fixed">Fixed Amount</option>
        </select></div>
        <div className="field"><label>Discount Value *</label><input type="number" min="0" step=".01"
          value={edit.discountValue} onChange={(event) => setEdit({ ...edit, discountValue: event.target.value })} /></div>
        <div className="field"><label>Minimum Purchase Amount</label><input type="number" min="0" step=".01"
          value={edit.minimumPurchaseAmount} onChange={(event) => setEdit({ ...edit, minimumPurchaseAmount: event.target.value })} /></div>
        <div className="field"><label>Applicable Payment Method</label><select value={edit.applicablePaymentMethod}
          onChange={(event) => setEdit({ ...edit, applicablePaymentMethod: event.target.value })}>
          <option value="all">All Payment Methods</option><option value="cash">Cash Payment</option>
          <option value="online">Online Payment</option>
        </select></div>
        <div className="field"><label>Start Date *</label><input type="date" value={edit.startAt}
          onChange={(event) => setEdit({ ...edit, startAt: event.target.value })} /></div>
        <div className="field"><label>Expiration Date *</label><input type="date" value={edit.expiresAt}
          onChange={(event) => setEdit({ ...edit, expiresAt: event.target.value })} /></div>
        <div className="field"><label>Total Usage Limit</label><input type="number" min="1" value={edit.totalUsageLimit}
          onChange={(event) => setEdit({ ...edit, totalUsageLimit: event.target.value })} placeholder="Unlimited" /></div>
        <div className="field"><label>Usage Limit per Client</label><input type="number" min="1" value={edit.usageLimitPerClient}
          onChange={(event) => setEdit({ ...edit, usageLimitPerClient: event.target.value })} placeholder="Unlimited" /></div>
        <div className="field span-2"><label>Applicable To *</label><select value={edit.applicableTo}
          onChange={(event) => setEdit({ ...edit, applicableTo: event.target.value })}>
          <option value="all">All Purchases</option>
          <option value="specific_classes">Specific Classes</option>
          <option value="specific_plans">Specific Plans</option>
          <option value="specific_packages">Specific Packages</option>
          <option value="regular_cash">Regular Cash Booking</option>
          <option value="online_payment">Online Payment</option>
        </select></div>
        {edit.applicableTo === "specific_classes" && <div className="field span-2">
          <label>Applicable Classes *</label><div className="promo-option-grid">
            {classes.map((item) => <label className="promo-option" key={item.id}>
              <input type="checkbox" checked={edit.applicableClassIds.includes(String(item.id))}
                onChange={() => toggleId("applicableClassIds", String(item.id))} />
              <span>{item.title}</span>
            </label>)}
          </div></div>}
        {["specific_plans", "specific_packages"].includes(edit.applicableTo) && <div className="field span-2">
          <label>Applicable Plans / Packages *</label><div className="promo-option-grid">
            {tiers.map((item) => <label className="promo-option" key={item.id}>
              <input type="checkbox" checked={edit.applicableTierIds.includes(String(item.id))}
                onChange={() => toggleId("applicableTierIds", String(item.id))} />
              <span>{item.name}</span>
            </label>)}
          </div></div>}
      </div>}
    </Modal>

    <Modal open={!!detail} onClose={() => setDetail(null)} title="Promo Code Details"
      footer={<button className="btn" onClick={() => setDetail(null)}>Close</button>}>
      {detail && <dl className="detail-list">
        <div><dt>Promo Code</dt><dd>{detail.code}</dd></div>
        <div><dt>Status</dt><dd>{label(detail.status)}</dd></div>
        <div><dt>Description</dt><dd>{detail.description || "—"}</dd></div>
        <div><dt>Discount</dt><dd>{detail.discountType === "percentage" ? `${detail.discountValue}%` : money(detail.discountValue)}</dd></div>
        <div><dt>Minimum Purchase</dt><dd>{money(detail.minimumPurchaseAmount)}</dd></div>
        <div><dt>Applicable To</dt><dd>{label(detail.applicableTo)}</dd></div>
        <div><dt>Applicable Records</dt><dd>{selectedNames.join(", ") || "All matching purchases"}</dd></div>
        <div><dt>Payment Method</dt><dd>{label(detail.applicablePaymentMethod)}</dd></div>
        <div><dt>Start Date</dt><dd>{date(detail.startAt)}</dd></div>
        <div><dt>Expiration Date</dt><dd>{date(detail.expiresAt)}</dd></div>
        <div><dt>Usage</dt><dd>{detail.usageCount} / {detail.totalUsageLimit || "Unlimited"}</dd></div>
        <div><dt>Per Client Limit</dt><dd>{detail.usageLimitPerClient || "Unlimited"}</dd></div>
      </dl>}
    </Modal>

    <Modal open={!!remove} onClose={() => !busy && setRemove(null)} title="Delete Promo Code"
      footer={<><button className="btn ghost" onClick={() => setRemove(null)}>Cancel</button>
        <button className="btn danger" disabled={busy} onClick={confirmDelete}>Delete Promo Code</button></>}>
      <div className="status-notice warning">Delete “{remove?.code}”? Used promo codes cannot be permanently deleted and will be deactivated instead.</div>
    </Modal>
  </div>;
}
