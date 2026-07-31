import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function AccountSecurity() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [busy, setBusy] = useState(false);
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword && user.emailVerified) return <Navigate to="/dashboard" replace />;

  const changePassword = async (event) => {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) return toast.error("New passwords do not match.");
    setBusy(true);
    try {
      const data = await api("/auth/change-password", {
        method: "POST",
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      setUser(data.user);
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("Your temporary password has been replaced.");
      if (data.user.emailVerified) navigate("/dashboard", { replace: true });
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };
  const resend = async () => {
    setBusy(true);
    try {
      await api("/auth/resend-verification", { method: "POST" });
      toast.success("A new verification link was sent.");
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };

  return <div className="login-wrap"><div className="login-card security-card">
    <div className="mark">ANINA</div><h1>Secure your account</h1>
    {user.mustChangePassword && <>
      <p>Replace the temporary Super Admin password before accessing the system.</p>
      <form className="auth-form" onSubmit={changePassword}>
        <div className="field"><label>Temporary password</label><input type="password"
          autoComplete="current-password" required value={form.currentPassword}
          onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} /></div>
        <div className="field"><label>New password</label><input type="password"
          autoComplete="new-password" required minLength="12" value={form.newPassword}
          onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /></div>
        <div className="field"><label>Confirm new password</label><input type="password"
          autoComplete="new-password" required minLength="12" value={form.confirmPassword}
          onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></div>
        <p className="auth-note">Use at least 12 characters with uppercase, lowercase, number, and symbol.</p>
        <button className="btn auth-submit" disabled={busy}>Change Password</button>
      </form>
    </>}
    {!user.emailVerified && <div className="security-verification">
      <h2>Verify your email</h2>
      <p>Open the single-use verification link sent to <strong>{user.email}</strong>. It expires after 24 hours.</p>
      <button className="btn ghost auth-submit" disabled={busy} onClick={resend}>Send a New Verification Link</button>
    </div>}
    <button className="auth-home" onClick={() => { logout(); navigate("/login"); }}>Sign out</button>
  </div></div>;
}

