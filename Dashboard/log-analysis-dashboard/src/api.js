 const API_BASE = "https://uxuqrg33t4.execute-api.ap-southeast-2.amazonaws.com/v1" || "http://localhost:8080";

export function setToken(token) {
  localStorage.setItem("token", token);
}

export function getToken() {
  const token = localStorage.getItem("token");
  return token && token !== "undefined" ? token : null;
}

export function clearToken() {
  localStorage.removeItem("token");
}

export async function apiFetch(path, options = {}) {
  const token = getToken();

  // Build headers safely
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  // Only set Content-Type if
  const hasBody = options.body !== undefined && options.body !== null;
  const isJsonBody =
    hasBody && typeof options.body === "object" && !(options.body instanceof FormData);
  if (isJsonBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (isJsonBody && typeof options.body === "object" && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
  }

  // Only add Authorization if a real token
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // Handle 204 No Content
  if (res.status === 204) return null;

  // Try to parse error bodies for better debugging
  if (!res.ok) {
    let detail = "";
    try {
      const text = await res.text();
      detail = text ? `\n${text}` : "";
    } catch {}
    throw new Error(`API ${res.status} ${res.statusText}${detail}`);
  }

  // Parse JSON response
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json();
  }
  // Fallback to text if not JSON
  return res.text();
}

export async function analyzeQueue(logId) {
  return apiFetch(`/logs/${logId}/analyze-queue`, { method: "POST" });
}

export async function getStatus(logId) {
  return apiFetch(`/logs/${logId}/status`);
}

export async function getSummarySmart(logId) {
  // Handles 202 "not ready" by returning { pending: true, ... }
  const res = await fetch(`${API_BASE}/logs/${logId}/summary`, {
    headers: new Headers({
      "Accept": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
    }),
  });
  if (res.status === 202) {
    return { pending: true, ...(await res.json()) };
  }
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  return { pending: false, ...(await res.json()) };
}