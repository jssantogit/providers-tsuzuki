import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Runs exclusively on an extracted, in-memory generated unsigned ZIP. This
// imports the ACTUAL MangaALL main/router, all three original source modules,
// and a future-only MangaDot chapter wrapper. No isolated substitute router.
const staging = process.argv[2];
assert.ok(staging && path.isAbsolute(staging));
const requests = [];
let nativeStart = 0;
let nativeNext = 0;
const workId = "mangadot:131", chapterCount = 4341;
const dexId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const nonce = "0123456789abcdef";
const chapters = Array.from({ length: chapterCount }, (_, i) => ({
  providerChapterId: "mangadot:uploads:" + (13100001 + i),
  rawLabel: "Ch. " + (i + 1),
  rawNumber: i + 1,
  title: null,
  language: "en",
  scanlationGroup: null,
  releaseDateMillis: null,
}));
function nativeSlice(from) {
  const items = chapters.slice(from, from + 240);
  const nextAt = from + items.length;
  const nextCursor = nextAt < chapterCount
    ? "m1:131:en:" + nonce + ":" + nextAt : null;
  const json = JSON.stringify({ items, nextCursor });
  assert.ok(json.length < 48 * 1024);
  return json;
}
globalThis.tsuzuki = {
  mangaAllChapterSnapshot: {
    async start(id, language) {
      assert.equal(id, workId);
      assert.equal(language, "en");
      nativeStart++;
      return nativeSlice(0);
    },
    async next(id, language, cursor) {
      assert.equal(id, workId);
      assert.equal(language, "en");
      assert.match(cursor, /^m1:131:en:0123456789abcdef:[1-9][0-9]{0,4}$/);
      nativeNext++;
      return nativeSlice(Number(cursor.slice(cursor.lastIndexOf(":") + 1)));
    },
  },
  http: {
    async request(method, url) {
      assert.equal(method, "GET");
      const u = new URL(url);
      requests.push({ host: u.hostname, path: u.pathname });
      if (u.hostname === "api.mangadex.org" && u.pathname === "/manga") {
        return JSON.stringify({ statusCode: 200, body: JSON.stringify({
          data: [{ id: dexId, type: "manga",
            attributes: { title: { en: "Bleach" }, altTitles: [] } }],
          total: 1, offset: 0,
        }) });
      }
      if (u.hostname === "mangadot.net" && u.pathname === "/api/search") {
        return JSON.stringify({ statusCode: 200, body: JSON.stringify({
          manga_list: [{ manga_id: 131, title: "Bleach" }],
          pagination: { current_page: 1, total_pages: 1 },
        }) });
      }
      if (u.hostname === "api.mangadex.org" && u.pathname === "/chapter") {
        return JSON.stringify({ statusCode: 200, body: JSON.stringify({
          data: [], total: 0, offset: 0,
        }) });
      }
      if (u.hostname === "mangafire.to") {
        // A real challenge remains a typed incomplete SOURCE observation,
        // NEVER a complete empty catalog and never browser bypass.
        return JSON.stringify({ statusCode: 403, body: "" });
      }
      throw Error("Unexpected synthetic HTTP request: " + u.origin + u.pathname);
    },
  },
};
const { default: unified } = await import(pathToFileURL(path.join(staging, "main.js")).href);
assert.deepEqual(Object.keys(unified), ["reading"]);
assert.deepEqual(
  ["lookup", "chapters", "pages"].map(k => typeof unified.reading[k]),
  ["function", "function", "function"],
);
const first = await unified.reading.lookup({ titles: ["Bleach"], requestedLanguage: "en" });
const ids = first.items.map(x => x.externalWorkId);
assert.ok(ids.includes("mangadex:" + dexId));
assert.ok(ids.includes("mangadot:131"));
assert.ok(requests.some(r => r.host === "mangafire.to"),
  "all three real source modules must participate in one lookup");
assert.ok(requests.some(r => r.host === "api.mangadex.org"));
assert.ok(requests.some(r => r.host === "mangadot.net"));
assert.ok(first.nextCursor, "MangaFire HTTP 403 cannot become a completed lookup");
assert.equal(nativeStart, 0, "lookup must not call the chapter bridge");

const seen = [];
let cursor = null, pages = 0;
do {
  const page = await unified.reading.chapters({
    binding: { providerId: "app.tsuzuki.mangaall", externalWorkId: workId, facetId: "en" },
    cursor,
  });
  assert.ok(page.items.length <= 256);
  seen.push(...page.items.map(x => x.providerChapterId));
  cursor = page.nextCursor;
  pages++;
  assert.ok(pages <= 32);
} while (cursor !== null);
assert.deepEqual(seen, chapters.map(x => x.providerChapterId));
assert.equal(nativeStart, 1);
assert.equal(nativeNext, pages - 1);
assert.ok(pages >= 17 && pages <= 32);
assert.equal(requests.filter(x => x.path === "/api/manga/131/chapters/list").length, 0,
  "future paged native source must not use legacy 192KiB HTTP text");

const dex = await unified.reading.chapters({
  binding: {
    providerId: "app.tsuzuki.mangaall",
    externalWorkId: "mangadex:" + dexId,
    facetId: "en",
  },
});
assert.deepEqual(dex, { items: [], nextCursor: null });
assert.equal(nativeStart, 1, "MangaDex chapters may not use MangaDot's native bridge");

const before = requests.length;
await assert.rejects(
  unified.reading.chapters({
    binding: { providerId: "foreign", externalWorkId: workId, facetId: "en" },
  }),
  /invalid work binding/i,
);
await assert.rejects(
  unified.reading.chapters({
    binding: { providerId: "app.tsuzuki.mangaall", externalWorkId: "mangafire:sample", facetId: "pt-br" },
  }),
  /unsupported language/i,
);
assert.equal(requests.length, before, "invalid scopes cannot touch HTTP");
assert.equal(nativeStart, 1, "invalid scopes cannot trigger snapshot acquisition");

console.log(
  "MANGAALL_FUTURE_CODE11|REAL_THREE_SOURCE_ROUTER=PASS|" +
  "MANGADEX=OBSERVED|MANGADOT=OBSERVED|MANGAFIRE_403=INCONCLUSIVE|" +
  "NATIVE_CHAPTERS=4341|PAGES=" + pages +
  "|NATIVE_START=ONE|SOURCE_LIST_HTTP=ZERO|CANONICAL=NOT_GRANTED|SIGNED_CODE10=UNCHANGED",
);
