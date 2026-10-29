const ORIGIN = "https://api.mangadex.org";
const MAX_JSON_BYTES = 1024 * 1024;

// Only fixed, reviewed endpoints and origins are available to this adapter.
export async function getMangaDexJson(endpoint, pairs = []) {
  if (endpoint !== "/manga" && endpoint !== "/chapter" && !/^\\/at-home\\/server\\/[0-9a-f-]{36}$/i.test(endpoint)) {
    throw new Error("MangaAll unsupported MangaDex endpoint");
  }
  const query = pairs.map(([key, value]) =>
    encodeURIComponent(String(key)) + "=" + encodeURIComponent(String(value))
  ).join("&");
  const url = ORIGIN + endpoint + (query ? "?" + query : "");
  const raw = await globalThis.tsuzuki.http.request(
    "GET",
    url,
    JSON.stringify({ Accept: "application/json" }),
  );
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (_) {
    throw new Error("MangaAll invalid HTTP response");
  }
  const status = envelope?.statusCode;
  if (!Number.isInteger(status)) throw new Error("MangaAll invalid HTTP status");
  // Fail closed on 403/429/challenges; no silent empty inventory or unbounded retries.
  if (status < 200 || status >= 300) throw new Error("MangaAll HTTP " + status);
  if (typeof envelope.body !== "string" || envelope.body.length > MAX_JSON_BYTES) {
    throw new Error("MangaAll invalid response size");
  }
  let result;
  try {
    result = JSON.parse(envelope.body);
  } catch (_) {
    throw new Error("MangaAll invalid JSON");
  }
  if (result?.result !== "ok" || (endpoint.startsWith("/at-home/") ? !result.chapter : !Array.isArray(result.data))) {
    throw new Error("MangaAll invalid API response");
  }
  return result;
}
