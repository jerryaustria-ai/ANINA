import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "../auth.jsx";

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const allowDev = import.meta.env.VITE_ALLOW_DEV_LOGIN === "true";

const DEV_USERS = [
  ["Admin", "patrick.ong.wong@gmail.com"],
  ["Instructor · Joycee", "joycee@aninasanctuary.ph"],
  ["Instructor · Maya", "maya@aninasanctuary.ph"],
  ["Client · Ana", "client1@example.com"],
  ["Client · Bea", "client2@example.com"],
];

export default function Login() {
  const { loginWithGoogle, loginWithPassword, devLogin } = useAuth();
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await loginWithPassword(form.email, form.password);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="mark">ANINA</div>
        <h1>Booking</h1>
        <p>Sign in to see your personal schedule.</p>

        {err && <div className="banner err">{err}</div>}

        <form className="auth-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" autoComplete="email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input id="auth-password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => update("password", e.target.value)} required />
          </div>
          <button className="btn auth-submit" disabled={busy}>{busy ? "Please wait…" : "Sign in"}</button>
        </form>

        <div className="auth-divider"><span>or continue with Google</span></div>

        {clientId ? (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <GoogleLogin
              onSuccess={(res) => loginWithGoogle(res.credential).catch((e) => setErr(e.message))}
              onError={() => setErr("Google sign-in failed")}
            />
          </div>
        ) : (
          <div className="banner warn">
            Google sign-in is not configured yet. Email and password are available above.
          </div>
        )}

        {allowDev && (
          <div className="dev-login">
            <h4>Dev sign-in (local only)</h4>
            {DEV_USERS.map(([label, email]) => (
              <div className="row" key={email}>
                <button onClick={() => devLogin(email).catch((e) => setErr(e.message))}>{label}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
