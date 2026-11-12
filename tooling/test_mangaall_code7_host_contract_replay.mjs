// Offline replay using the EXACT production MangaAll 0.5.2/code7 entrypoint.
// HTTP bodies are intentionally synthetic fixtures, NOT captured source truth.
// The Host canonical reconciliation, signed delivery and Reader pixels are
// separate gates and cannot be inferred from this script.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/mangaall");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.id, "app.tsuzuki.mangaall");
assert.equal(manifest.version.code, 7);
assert.equal(manifest.version.name, "0.5.2");
assert.deepEqual(manifest.capabilities.map(({ id }) => id), [
  "reading.lookup", "reading.chapters", "reading.pages",
]);
assert.ok(manifest.permissions.network.origins.includes("https://mfcdn.cc"));
const exportPath = process.argv.length === 4 && process.argv[2] === "--export"
  ? process.argv[3] : null;
if (process.argv.length !== 2 && !exportPath) {
  throw Error("Usage: node tooling/test_mangaall_code7_host_contract_replay.mjs [--export /path/to/output.json]");
}
const replayVectors = [];
const fixtures = [
  { id: "punpun", title: "Oyasumi Punpun", sourceTitle: "Goodnight Punpun",
    hid: "zk12", alias: "Oyasumi Punpun", author: "Inio Asano",
    chapterId: "punpun-fixture-ch1", image: "https://mfcdn.cc/replay/punpun/ch1.png" },
  { id: "koe", title: "Koe no Katachi", sourceTitle: "Koe no Katachi",
    hid: "7p56", alias: "A Silent Voice", author: "Yoshitoki Ooima",
    chapterId: "koe-fixture-ch1", image: "https://mfcdn.cc/replay/koe/ch1.png" },
];
const byWork = new Map(fixtures.map((f) => [f.hid, f]));
const byChapter = new Map(fixtures.map((f) => [f.chapterId, f]));
let active = null;
let blockedPath = null;
const requests = [];
const ok = (body) => JSON.stringify({ statusCode: 200, body: JSON.stringify(body) });
const blocked = (statusCode = 403) =>
  JSON.stringify({ statusCode, body: "<html>upstream challenge</html>" });

globalThis.tsuzuki = { http: { async request(method, url, headersJson) {
  const u = new URL(url);
  assert.equal(method, "GET");
  assert.ok(["https://mangafire.to", "https://api.mangadex.org", "https://mangadot.net"].includes(u.origin),
    "the test must never contact an ungranted source or CDN");
  assert.ok(manifest.permissions.network.origins.includes(u.origin));
  assert.ok(JSON.parse(headersJson).Accept);
  requests.push({ origin: u.origin, path: u.pathname });
  if (u.origin === "https://api.mangadex.org") {
    if (u.pathname === "/chapter") {
      return ok({ result: "ok", data: [], limit: 100, offset: 0, total: 0 });
    }
    if (u.pathname === "/manga") {
      return ok({ result: "ok", data: [], limit: 25, offset: 0, total: 0 });
    }
    throw Error("unexpected MangaDex fixture path: " + u.pathname);
  }
  if (u.origin === "https://mangadot.net") {
    if (u.pathname === "/api/search") return ok({ results: [] });
    throw Error("unexpected MangaDot fixture path: " + u.pathname);
  }
  if (u.pathname === "/api/titles") {
    assert.equal(u.searchParams.get("keyword"), active.title);
    if (blockedPath === "lookup") return blocked();
    return ok({ items: [{ hid: active.hid, slug: active.id,
      title: active.sourceTitle, aliases: [active.alias] }] });
  }
  const detail = /^\/api\/titles\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
  if (detail) {
    if (blockedPath === "detail") return blocked();
    const f = byWork.get(detail[1]);
    assert.ok(f, "unexpected title details");
    return ok({ data: { hid: f.hid, title: f.sourceTitle, aliases: [f.alias],
      authors: [f.author] } });
  }
  const chapterList = /^\/api\/titles\/([A-Za-z0-9_-]+)\/chapters$/.exec(u.pathname);
  if (chapterList) {
    if (blockedPath === "chapters") return blocked();
    const f = byWork.get(chapterList[1]);
    assert.ok(f, "unexpected chapter list work");
    assert.equal(u.searchParams.get("language"), "en");
    assert.equal(u.searchParams.get("order"), "asc");
    assert.equal(u.searchParams.get("page"), "1");
    return ok({
      items: [{ id: f.chapterId, number: 1, name: "Chapter 1",
        language: "en", type: "official", createdAt: 1720000000 }],
      meta: { hasNext: false, lastPage: 1 },
    });
  }
  const pageRoute = /^\/api\/chapters\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
  if (pageRoute) {
    if (blockedPath === "pages") return blocked(503);
    const f = byChapter.get(pageRoute[1]);
    assert.ok(f, "unexpected chapter page identity");
    return ok({ data: { id: f.chapterId, mangaHid: f.hid,
      language: "en", pages: [{ url: f.image }] } });
  }
  throw Error("unexpected MangaFire fixture path: " + u.pathname);
} } };

// The ONLY reading implementation used is the imported real JS router and
// its three actual internal source adapters.
const actual = (await import(pathToFileURL(path.join(root, "main.js")).href)).default;
assert.deepEqual(Object.keys(actual), ["reading"]);
const reading = actual.reading;
for (const method of ["lookup", "chapters", "pages"]) assert.equal(typeof reading[method], "function");
const lookupRequest = (f) => ({
  titles: [f.title], requestedLanguage: "en",
  diagnosticsVersion: 2, editorialEvidenceVersion: 1, coverageEvidenceVersion: 1,
});
const binding = (f) => ({
  providerId: manifest.id, facetId: "en", externalWorkId: "mangafire:" + f.hid,
});

for (const f of fixtures) {
  active = f;
  blockedPath = null;
  const before = requests.length;
  const lookup = await reading.lookup(lookupRequest(f));
  const matched = lookup.items.find((v) => v.externalWorkId === "mangafire:" + f.hid);
  assert.ok(matched, f.id + ": source-attested MangaFire HID missing");
  assert.equal(matched.title, f.sourceTitle);
  assert.ok(matched.aliases.includes(f.alias));
  assert.deepEqual(matched.authors, [f.author]);
  assert.equal(matched.detailOutcome, "VERIFIED_WITH_ALIASES");
  assert.equal(matched.coverageOutcome, "OBSERVED",
    "code7 singleton HID must have first-page coverage preview when opt-in is verified");
  assert.equal(matched.coverageObservedCount, 1);
  assert.equal(matched.coverageHasMore, false);
  assert.equal(matched.coverageMinMilli, 1000);
  assert.equal(matched.coverageMaxMilli, 1000);
  assert.equal(lookup.nextCursor, null);
  assert.ok(requests.slice(before).some((v) => v.origin === "https://api.mangadex.org"));
  assert.ok(requests.slice(before).some((v) => v.origin === "https://mangadot.net"));
  assert.ok(requests.slice(before).some((v) => v.path === "/api/titles/" + f.hid + "/chapters"));

  const previewsBefore = requests.filter((v) => v.path.endsWith("/chapters")).length;
  const legacy = await reading.lookup({ titles: [f.title], requestedLanguage: "en" });
  const legacyCandidate = legacy.items.find((v) => v.externalWorkId === "mangafire:" + f.hid);
  assert.ok(legacyCandidate);
  assert.equal(legacyCandidate.coverageOutcome, undefined,
    "no Host opt-in means no coverage authority");
  assert.equal(requests.filter((v) => v.path.endsWith("/chapters")).length, previewsBefore,
    "unrequested preview must not issue chapter HTTP");

  const inventory = await reading.chapters({ binding: binding(f) });
  assert.equal(inventory.nextCursor, null);
  assert.equal(inventory.items.length, 1);
  assert.equal(inventory.items[0].providerChapterId, "mangafire:" + f.chapterId);
  assert.equal(inventory.items[0].rawNumber, 1);
  assert.equal(inventory.items[0].language, "en");
  assert.match(inventory.items[0].rawLabel, /Ch[.] 1/);
  const callsBeforeForgery = requests.length;
  await assert.rejects(reading.pages({
    binding: binding(f), providerChapterId: "mangadex:foreign-chapter",
  }), /chapter source mismatch/i);
  assert.equal(requests.length, callsBeforeForgery, "cross-source chapter blocked before network");

  const pages = await reading.pages({
    binding: binding(f), providerChapterId: inventory.items[0].providerChapterId,
  });
  assert.deepEqual(pages, { type: "page_list",
    pages: [{ url: f.image, headers: { Referer: "https://mangafire.to" } }] });
  assert.equal(requests.some((v) => v.origin === "https://mfcdn.cc"), false,
    "source returns page metadata; image download remains Host-owned");
  // These are the exact objects emitted by the real code7 JS adapters.
  // Android Host tests consume the generated outputs as a transport-replay
  // boundary. They do not execute the original code7 JavaScript on Android.
  replayVectors.push({
    caseId: f.id,
    requestedTitle: f.title,
    sourceWorkId: "mangafire:" + f.hid,
    sourceChapterId: "mangafire:" + f.chapterId,
    lookup: legacy,
    richLookup: lookup,
    chapters: inventory,
    pages,
  });
  const foreign = fixtures.find((v) => v.hid !== f.hid);
  await assert.rejects(reading.pages({
    binding: binding(f), providerChapterId: "mangafire:" + foreign.chapterId,
  }), /work identity mismatch/i);
  console.log("CODE7_REPLAY|case=" + f.id +
    "|source=REAL_JS_MOCK_HTTP|coverage=OBSERVED_FIRST_PAGE|chapters=1|pageMetadata=PASS|foreignWork=REJECTED");
}

// A complete-empty MangaDex/en persisted binding and a separate verified
// MangaFire work are simultaneous source facts, NOT automatic edition binding.
active = fixtures[0];
const preferredDex = await reading.chapters({
  binding: { providerId: manifest.id, facetId: "en",
    externalWorkId: "mangadex:11111111-2222-4333-8444-555555555555" },
});
assert.deepEqual(preferredDex, { items: [], nextCursor: null });
const afterEmpty = await reading.lookup(lookupRequest(active));
assert.equal(afterEmpty.items.find((v) => v.externalWorkId === "mangafire:zk12")?.coverageOutcome,
  "OBSERVED");
console.log("CODE7_REPLAY|case=punpun|mangadex=COMPLETE_EMPTY|mangafire=PROVISIONAL_COVERAGE|autoRebind=NOT_TESTED");

// Real code7 source challenge paths MUST NOT convert 403 to complete zero.
active = fixtures[1];
blockedPath = "chapters";
const challenged = await reading.lookup(lookupRequest(active));
assert.equal(challenged.items.find((v) => v.externalWorkId === "mangafire:7p56")?.coverageOutcome,
  "CHALLENGE_BLOCKED");
await assert.rejects(reading.chapters({ binding: binding(active) }), /challenge required/);
blockedPath = "lookup";
const blockedLookup = await reading.lookup(lookupRequest(active));
assert.deepEqual(blockedLookup.items, []);
assert.ok(blockedLookup.nextCursor,
  "403 must remain an incomplete retryable lookup, not a complete empty source");
assert.ok(blockedLookup.nextCursor.length <= 512);
blockedPath = null;
console.log("CODE7_REPLAY|case=koe|upstream403=INCONCLUSIVE|completedEmpty=FORBIDDEN");
if (exportPath) {
  // No live requests, cookies, tokens, actual chapter/page bytes or user data.
  // Test fixtures only; the Host must treat these as synthetic observations.
  const output = {
    schemaVersion: 1,
    provenance: "real_code7_js_with_synthetic_http_fixtures_not_live_source",
    providerId: manifest.id,
    providerVersionCode: manifest.version.code,
    cases: replayVectors,
    preferredEmpty: { source: "mangadex", itemCount: preferredDex.items.length,
      complete: preferredDex.nextCursor === null },
    challenge: { source: "mangafire", outcome: "CHALLENGE_BLOCKED",
      complete: blockedLookup.nextCursor === null },
  };
  fs.writeFileSync(exportPath, JSON.stringify(output, null, 2) + "\n");
  console.log("CODE7_REPLAY|export=HOST_CONTRACT_FIXTURE|cases=" + replayVectors.length);
}
console.log("MangaAll real code7 offline source/Host-V1 contract replay PASS; Host canonical/Reader/published package NOT tested");
