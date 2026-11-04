const ORIGIN = "https://api.mangadex.org";
export const MANGAALL_USER_AGENT = "Tsuzuki-MangaAll/0.1 (+https://github.com/jssantogit/providers-tsuzuki)";
const MAX_JSON_BYTES = 1024 * 1024;

// Only fixed, reviewed endpoints and origins are available to this adapter.
export async function getMangaDexJson(endpoint, pairs = []) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const atHomeId = endpoint.startsWith("/at-home/server/") ? endpoint.slice("/at-home/server/".length) : null;
  const chapterId = endpoint.startsWith("/chapter/") ? endpoint.slice("/chapter/".length) : null;
  const atHomeAllowed = atHomeId !== null && uuid.test(atHomeId);
  const chapterEntityAllowed = chapterId !== null && uuid.test(chapterId);
  if (endpoint !== "/manga" && endpoint !== "/chapter" &&
      !atHomeAllowed && !chapterEntityAllowed) {
    throw new Error("MangaAll unsupported MangaDex endpoint");
  }
  const query = pairs.map(([key, value]) =>
    encodeURIComponent(String(key)) + "=" + encodeURIComponent(String(value))
  ).join("&");
  const url = ORIGIN + endpoint + (query ? "?" + query : "");
  const raw = await globalThis.tsuzuki.http.request(
    "GET",
    url,
    JSON.stringify({ Accept: "application/json", "User-Agent": MANGAALL_USER_AGENT }),
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
  if (result?.result !== "ok" ||
      (atHomeAllowed ? !result.chapter :
        chapterEntityAllowed ? result.data?.type !== "chapter" || !Array.isArray(result.data?.relationships) :
          !Array.isArray(result.data))) {
    throw new Error("MangaAll invalid API response");
  }
  return result;
}
