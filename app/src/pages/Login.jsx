import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "../auth.jsx";
import { toast } from "react-toastify";

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
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await loginWithPassword(form.email, form.password);
      toast.success(`Welcome back, ${user.name}.`);
    } catch (error) {
      toast.error(error.message);
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
              onSuccess={(res) => loginWithGoogle(res.credential)
                .then((user) => toast.success(`Welcome, ${user.name}.`))
                .catch((e) => toast.error(e.message))}
              onError={() => toast.error("Google sign-in failed. Please try again.")}
            />
          </div>
        ) : (
          <div className="auth-note">
            Google sign-in is not configured yet. Email and password are available above.
          </div>
        )}

        {allowDev && (
          <div className="dev-login">
            <h4>Dev sign-in (local only)</h4>
            {DEV_USERS.map(([label, email]) => (
              <div className="row" key={email}>
                <button onClick={() => devLogin(email)
                  .then((user) => toast.success(`Signed in as ${user.name}.`))
                  .catch((e) => toast.error(e.message))}>{label}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
