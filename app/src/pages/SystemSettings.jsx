import { useEffect, useState } from "react";
import { api } from "../api.js";
import { toast } from "react-toastify";

const DEFINITIONS = [
  ["business_name", "Business name", "text"],
  ["timezone", "Configured timezone", "text"],
  ["support_email", "Support email", "email"],
  ["payment_provider_enabled", "Online payment gateway enabled", "checkbox"],
  ["cash_payments_enabled", "Cash payments enabled", "checkbox"],
  ["email_notifications_enabled", "Email notifications enabled", "checkbox"],
  ["notification_poll_seconds", "Notification refresh interval (seconds)", "number"],
];

export default function SystemSettings() {
  const [values, setValues] = useState({});
  useEffect(() => {
    api("/super-admin/settings").then(({ settings }) =>
      setValues(Object.fromEntries(settings.map((item) => [item.key, item.value]))))
      .catch((error) => toast.error(error.message));
  }, []);
  const save = async (key) => {
    try {
      await api(`/super-admin/settings/${key}`, { method: "PUT", body: { value: values[key] } });
      toast.success("System setting saved.");
    } catch (error) { toast.error(error.message); }
  };
  return <div className="cms-page"><div className="cms-heading"><div>
    <h1>System Settings</h1><p>Global configuration is available only to Super Admins.</p></div></div>
    <section className="cms-card settings-list">
      {DEFINITIONS.map(([key, label, type]) => <label key={key}>
        <span>{label}</span>
        {type === "checkbox"
          ? <input type="checkbox" checked={!!values[key]} onChange={(event) =>
            setValues({ ...values, [key]: event.target.checked })} />
          : <input type={type} value={values[key] ?? ""} onChange={(event) =>
            setValues({ ...values, [key]: type === "number" ? Number(event.target.value) : event.target.value })} />}
        <button className="btn" onClick={() => save(key)}>Save</button>
      </label>)}
      <p className="field-hint">Secret API keys and SMTP passwords remain server environment variables and are never returned to the browser.</p>
    </section>
  </div>;
}

