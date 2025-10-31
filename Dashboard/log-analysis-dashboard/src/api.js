const API_BASE = "http://3.26.7.52:3000";

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
