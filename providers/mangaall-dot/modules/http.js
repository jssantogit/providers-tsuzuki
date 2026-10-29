// Restrict every request to one declared source origin and reviewed endpoints.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function makeClient(origin, allowedPaths) {
  return async function api(method, pathname, query = [], body = null) {
    if (!allowedPaths.some((rule) => typeof rule === "string" ? pathname === rule : rule.test(pathname))) {
      throw new Error("MangaAll unsupported endpoint");
    }
    if (method !== "GET" && method !== "POST") throw new Error("MangaAll unsupported method");
    if (method === "POST" && (body === null || typeof body !== "object")) {
      throw new Error("MangaAll invalid POST body");
    }
    const params = query.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v))).join("&");
    const url = origin + pathname + (params ? "?" + params : "");
    const headers = { Accept: "application/json" };
    if (method === "POST") headers["Content-Type"] = "application/json";
    const result = await globalThis.tsuzuki.http.request(
      method, url, JSON.stringify(headers), method === "POST" ? JSON.stringify(body) : undefined,
    );
    let envelope;
    try { envelope = JSON.parse(result); } catch (_) { throw new Error("MangaAll invalid HTTP response"); }
    if (!Number.isInteger(envelope?.statusCode)) throw new Error("MangaAll invalid HTTP response");
    if (envelope.statusCode < 200 || envelope.statusCode >= 300) {
      throw new Error("MangaAll HTTP " + envelope.statusCode);
    }
    if (typeof envelope.body !== "string" || envelope.body.length > MAX_RESPONSE_BYTES) {
      throw new Error("MangaAll invalid response size");
    }
    let value;
    try { value = JSON.parse(envelope.body); } catch (_) { throw new Error("MangaAll invalid JSON"); }
    if (value === null || typeof value !== "object") throw new Error("MangaAll invalid API response");
    return value;
  };
}
export function safeText(value, max = 1024) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
export function sourceId(key, value) {
  if (typeof value !== "string" || !value.startsWith(key + ":")) throw new Error("MangaAll unsupported source");
  const id = value.slice(key.length + 1);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("MangaAll invalid work ID");
  return id;
}
export function chapterNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const str = String(value);
  if (!/^[0-9]{1,6}(?:\.[0-9]{1,3})?$/.test(str)) return null;
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : null;
}
export function dateMillis(raw) {
  const millis = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(millis) && millis >= 0 ? millis : null;
}
export function facetLang(input) {
  const lang = input?.binding?.facetId || "en";
  if (lang !== "en" && lang !== "pt-br") throw new Error("MangaAll unsupported language");
  return lang;
}

// The host will grant additional image CDN origins only after live verification.
export function trustedImageUrl(raw, origin) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048 ||
      /[\\\\\u0000-\u001f]/.test(raw) || /%(?:2e|2f|5c)/i.test(raw)) {
    throw new Error("MangaAll untrusted image origin");
  }
  const absolute = raw.startsWith("/") && !raw.startsWith("//") ? origin + raw : raw;
  if (!absolute.startsWith(origin + "/") || absolute.includes("/../") ||
      absolute.includes("/./") || absolute.includes("?redirect=")) {
    throw new Error("MangaAll untrusted image origin");
  }
  return absolute;
}
