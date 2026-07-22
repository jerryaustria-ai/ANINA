const BASE = import.meta.env.VITE_API_BASE || "/api";

let token = localStorage.getItem("anina_token") || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem("anina_token", t);
  else localStorage.removeItem("anina_token");
}
export function getToken() {
  return token;
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
