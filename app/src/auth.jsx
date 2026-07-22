import { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, getToken } from "./api.js";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session from a stored token on load.
  useEffect(() => {
    (async () => {
      if (!getToken()) return setLoading(false);
      try {
        const { user } = await api("/auth/me");
        setUser(user);
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function loginWithGoogle(credential) {
    const { token, user } = await api("/auth/google", { method: "POST", body: { credential } });
    setToken(token);
    setUser(user);
    return user;
  }

  async function loginWithPassword(email, password) {
    const { token, user } = await api("/auth/login", { method: "POST", body: { email, password } });
    setToken(token);
    setUser(user);
    return user;
  }

  async function devLogin(email) {
    const { token, user } = await api("/auth/dev-login", { method: "POST", body: { email } });
    setToken(token);
    setUser(user);
    return user;
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <AuthCtx.Provider value={{ user, loading, loginWithGoogle, loginWithPassword, devLogin, logout, setUser }}>
      {children}
    </AuthCtx.Provider>
  );
}
