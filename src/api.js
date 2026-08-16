const apiBase = (window.MACROFLOW_API_BASE || "").replace(/\/$/, "");

export async function apiFetch(url, options = {}, session = null) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  const response = await fetch(`${apiBase}${url}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
