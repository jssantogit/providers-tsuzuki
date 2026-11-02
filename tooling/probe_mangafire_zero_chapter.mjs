/* Read-only, bounded issue #176 probe. Never log body, VRF URL, image URLs, cookies or headers. */
import { chaptersForTitle, pagesForChapter } from "../providers/mangafire/modules/api.js";

const cases = [
  { work: "dkw", chapter: "9324579" }, // One Piece, 182 pages on physical Reader
  { work: "rl2vm", chapter: "7336925" }, // 186-page chapter-zero candidate
  { work: "0w5k", chapter: "7422102" }, // Chainsaw Man, 191 pages
];
const networkOrigin = "https://mangafire.to";

globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson) {
      const parsed = new URL(url);
      if (method !== "GET" || parsed.origin !== networkOrigin) {
        throw new Error("PROBE_NETWORK_POLICY");
      }
      const requestHeaders = JSON.parse(headersJson);
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: String(requestHeaders.Accept ?? "application/json") },
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
      const declaredSize = Number(response.headers.get("content-length") ?? 0);
      if (declaredSize > 1_500_000) throw new Error("PROBE_OVERSIZE");
      const body = await response.text();
      if (body.length > 1_500_000) throw new Error("PROBE_OVERSIZE");
      return JSON.stringify({ statusCode: response.status, body });
    },
  },
};

const scalar = value =>
  value == null ? null :
  typeof value === "number" && Number.isFinite(value) ? value :
  typeof value === "string" ? value.replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 80) :
  null;
const readFields = item => Object.fromEntries(
  ["id", "number", "volume", "name", "type", "language", "mangaHid", "titleHid", "workHid"]
    .map(k => [k, scalar(item?.[k])]),
);
function classify(error) {
  const safeMessage = String(error?.message ?? "");
  if (/challenge|HTTP 403|HTTP 429|browser host service/i.test(safeMessage)) return "CHALLENGE_OR_RATE_LIMIT";
  if (/timeout|abort/i.test(safeMessage)) return "TIMEOUT";
  if (/PROBE_NETWORK_POLICY/.test(safeMessage)) return "PROBE_NETWORK_POLICY";
  if (/PROBE_OVERSIZE/.test(safeMessage)) return "PROBE_OVERSIZE";
  if (/HTTP [0-9]+/.test(safeMessage)) return "HTTP_ERROR";
  if (/invalid|JSON|SyntaxError|Unexpected token/i.test(safeMessage)) return "INVALID_RESPONSE";
  return "UPSTREAM_UNAVAILABLE";
}
let verified = 0;
for (const test of cases) {
  const record = { work: test.work, chapter: test.chapter };
  try {
    const res = await chaptersForTitle(test.work, "en", 1);
    record.chapters = {
      item_count: Array.isArray(res?.items) ? res.items.length : null,
      matching: Array.isArray(res?.items)
        ? (res.items.find(it => String(it.id) === test.chapter) ?? null)
        : null,
    };
    record.chapters.matching = record.chapters.matching == null
      ? null
      : readFields(record.chapters.matching);
  } catch (error) {
    record.chapter_catalog_failure = classify(error);
  }
  try {
    const res = await pagesForChapter(test.chapter);
    record.pages = res?.data == null ? null : {
      metadata: readFields(res.data),
      page_count: Array.isArray(res.data.pages) ? res.data.pages.length : null,
    };
  } catch (error) {
    record.page_metadata_failure = classify(error);
  }
  if (record.chapters?.matching && record.pages) verified += 1;
  // This audit intentionally discards page URLs, image bytes and response bodies.
  process.stdout.write(JSON.stringify(record) + "\n");
}
if (verified === 0) {
  process.stdout.write("PROBE_INCONCLUSIVE: source denied or did not supply matching public chapter metadata\n");
  process.exitCode = 2;
}
