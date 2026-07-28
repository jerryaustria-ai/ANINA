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

export async function downloadApi(path, filename) {
  const res = await fetch(BASE + path, {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Download failed (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function notifyScheduleChanged(path, method) {
  if (method === "GET" ||
      (!path.startsWith("/sessions") && !path.startsWith("/bookings") && !path.startsWith("/check-in"))) return;
  const revision = JSON.stringify({ at: Date.now(), path, method });
  localStorage.setItem("anina_schedule_revision", revision);
  window.dispatchEvent(new CustomEvent("anina:schedule-changed", {
    detail: { path, method },
  }));
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
    err.code = data.code;
    err.details = data.details;
    throw err;
  }
  notifyScheduleChanged(path, method.toUpperCase());
  return data;
}
