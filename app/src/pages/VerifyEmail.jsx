import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function VerifyEmail() {
  const { user, setUser } = useAuth();
  const [state, setState] = useState({ loading: true, error: "" });
  const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  useEffect(() => {
    if (!token) return setState({ loading: false, error: "Verification token is missing." });
    api("/auth/verify-email", { method: "POST", body: { token } })
      .then(async () => {
        if (user) {
          const current = await api("/auth/me");
          setUser(current.user);
        }
        setState({ loading: false, error: "" });
      })
      .catch((error) => setState({ loading: false, error: error.message }));
  }, [token]);
  return <div className="login-wrap"><div className="login-card security-card">
    <div className="mark">ANINA</div>
    <h1>{state.loading ? "Verifying…" : state.error ? "Verification failed" : "Email verified"}</h1>
    <p>{state.loading ? "Please wait while the secure link is verified."
      : state.error || "Your email address is verified. You may continue securing your account."}</p>
    {!state.loading && <Link className="btn auth-submit" to="/account-security">
      {state.error ? "Return to Sign In" : "Continue"}
    </Link>}
  </div></div>;
}
