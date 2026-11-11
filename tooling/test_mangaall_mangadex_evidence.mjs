import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mangaId = "11111111-2222-4333-8444-555555555555";
const chapterId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let detailId = mangaId;
let creator = "Takehiko Inoue";
let translatedLanguage = "en";
let relatedMangaId = mangaId;
let detailCalls = 0;
let chapterCalls = 0;
const seen = [];
const response = (data) => JSON.stringify({ statusCode: 200, body: JSON.stringify({ result: "ok", ...data }) });

globalThis.tsuzuki = { http: { async request(method, url) {
  const parsed = new URL(url);
  seen.push(parsed);
  assert.equal(method, "GET");
  assert.equal(parsed.origin, "https://api.mangadex.org");
  if (parsed.pathname === "/manga") {
    return response({ offset: 0, total: 1, data: [{
      type: "manga", id: mangaId, attributes: { title: { en: "Vagabond" }, altTitles: [] },
    }] });
  }
  if (parsed.pathname === "/manga/" + mangaId) {
    detailCalls++;
    assert.ok(parsed.searchParams.getAll("includes[]").includes("author"));
    return response({ data: {
      type: "manga", id: detailId, attributes: { title: { en: "Vagabond" }, altTitles: [] },
      relationships: [{ type: "author", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        attributes: { name: creator } }],
    } });
  }
  if (parsed.pathname === "/chapter") {
    chapterCalls++;
    assert.equal(parsed.searchParams.get("manga"), mangaId);
    assert.deepEqual(parsed.searchParams.getAll("translatedLanguage[]"), [translatedLanguage]);
    return response({ offset: 0, total: 1, data: [{
      type: "chapter", id: chapterId,
      attributes: { chapter: "1", translatedLanguage },
      relationships: [{ type: "manga", id: relatedMangaId }],
    }] });
  }
  throw Error("Unexpected API path: " + parsed.pathname);
}}};
const { lookup, pages } = await import(pathToFileURL(path.resolve(
  "providers/mangaall/modules/sources/mangadex/modules/mangadex.js",
)).href);
const request = (requestedLanguage) => ({
  titles: ["Vagabond"], editorialEvidenceVersion: 1,
  coverageEvidenceVersion: 1, requestedLanguage,
});
const english = (await lookup(request("en"))).items[0];
assert.deepEqual(english.authors, ["Takehiko Inoue"]);
assert.equal(english.detailOutcome, "VERIFIED_NO_ALIASES");
assert.equal(english.coverageOutcome, "OBSERVED");
assert.equal(english.coverageObservedCount, 1);
assert.equal(english.coverageMinMilli, 1000);
assert.equal(english.coverageMaxMilli, 1000);
assert.equal(english.coverageHasMore, false);
assert.equal(detailCalls, 1);
assert.equal(chapterCalls, 1);

detailId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const foreign = (await lookup(request("en"))).items[0];
assert.notEqual(foreign.detailOutcome, "VERIFIED_NO_ALIASES");
assert.deepEqual(foreign.authors || [], [], "foreign work details cannot attest authors");
assert.notEqual(foreign.coverageOutcome, "OBSERVED", "foreign work must never promote chapter coverage");
detailId = mangaId;

creator = "";
const noCreator = (await lookup(request("en"))).items[0];
assert.deepEqual(noCreator.authors || [], [], "missing author cannot be assumed");
creator = "Takehiko Inoue";

relatedMangaId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const foreignChapter = (await lookup(request("en"))).items[0];
assert.notEqual(foreignChapter.coverageOutcome, "OBSERVED",
  "a chapter from a foreign MangaDex work cannot attest this source's coverage");
relatedMangaId = mangaId;

translatedLanguage = "pt-br";
const portuguese = (await lookup(request("pt-br"))).items[0];
assert.equal(portuguese.coverageOutcome, "OBSERVED");
const enMismatch = (await lookup(request("en"))).items[0];
assert.notEqual(enMismatch.coverageOutcome, "OBSERVED",
  "a Portuguese-only page is not an English coverage attestation");
const before = chapterCalls;
await lookup({ titles: ["Vagabond"], editorialEvidenceVersion: 1, coverageEvidenceVersion: 1 });
assert.equal(chapterCalls, before, "unknown facet must never get cross-language coverage");

// The MangaDex API accepts up to 100 search rows, but the former 20-item
// query turned broad title searches into many round trips under the Host's
// strict eight-page deadline. A conservative 50-row page must preserve every
// source ID and its exact continuation offset.
const paginationCalls = [];
const totalWorks = 53;
globalThis.tsuzuki = { http: { async request(method, url) {
  assert.equal(method, "GET");
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/manga");
  const size = Number(parsed.searchParams.get("limit"));
  const offset = Number(parsed.searchParams.get("offset"));
  assert.equal(size, 25, "MangaDex discovery must fit the Host 192 KiB response cap");
  paginationCalls.push([offset, size]);
  const rows = Array.from({ length: Math.min(size, totalWorks - offset) }, (_, index) => ({
    id: "11111111-2222-4333-8444-" + (offset + index + 1).toString(16).padStart(12, "0"),
    type: "manga", attributes: { title: { en: "Vagabond" }, altTitles: [], description: { en: "d".repeat(7000) } },
  }));
  const body = JSON.stringify({ result: "ok", offset, total: totalWorks, data: rows });
  if (body.length > 192 * 1024) {
    throw new Error("Provider HTTP text response exceeds the size limit");
  }
  return JSON.stringify({ statusCode: 200, body });
} } };
const firstBroad = await lookup({ titles: ["Vagabond"] });
assert.equal(firstBroad.items.length, 25);
assert.equal(firstBroad.nextCursor, "25");
const middleBroad = await lookup({ titles: ["Vagabond"], cursor: firstBroad.nextCursor });
assert.equal(middleBroad.items.length, 25);
assert.equal(middleBroad.nextCursor, "50");
const lastBroad = await lookup({ titles: ["Vagabond"], cursor: middleBroad.nextCursor });
assert.equal(lastBroad.items.length, 3);
assert.equal(lastBroad.nextCursor, null);
assert.deepEqual(paginationCalls, [[0, 25], [25, 25], [50, 25]]);
assert.equal(new Set([...firstBroad.items, ...middleBroad.items, ...lastBroad.items].map(row => row.externalWorkId)).size,
  totalWorks, "increasing source page size cannot drop or duplicate source identities");

// Physical A54 0.5.0 saw a generic SCRIPT_ERROR in MangaDex reading.pages.
// The next provider must report a closed stage without leaking upstream text,
// while preserving exact chapter/work/language and image-origin policy.
const pageRequest = {
  diagnosticsVersion: 2,
  binding: { externalWorkId: "mangadex:" + mangaId, facetId: "en" },
  providerChapterId: "mangadex:" + chapterId,
};
let relatedId = mangaId, deliveryLanguage = "en", externalUrl = null;
let detailFailed = false, atHomeFailed = false, homeBase = "https://uploads.mangadex.org";
let atHomeFiles = ["page-one.jpg"];
const pageRequests = [];
globalThis.tsuzuki = { http: { async request(method, url) {
  assert.equal(method, "GET");
  const route = new URL(url).pathname;
  pageRequests.push(route);
  if (route === "/chapter/" + chapterId) {
    if (detailFailed) throw new Error("upstream token/private body must not leave adapter");
    return response({ data: {
      id: chapterId, type: "chapter",
      attributes: { translatedLanguage: deliveryLanguage, ...(externalUrl ? { externalUrl } : {}) },
      relationships: [{ type: "manga", id: relatedId }],
    } });
  }
  if (route === "/at-home/server/" + chapterId) {
    if (atHomeFailed) throw new Error("sensitive MangaDex@Home response");
    return response({ baseUrl: homeBase, chapter: {
      hash: "a".repeat(32), data: atHomeFiles,
    } });
  }
  throw new Error("unexpected fixture endpoint");
} } };
async function assertPageFailure(stage) {
  const result = await pages(pageRequest);
  assert.deepEqual(result, { type: "page_failure", pageFailureStage: stage });
  assert.equal(JSON.stringify(result).includes("private"), false);
}
relatedId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
await assertPageFailure("CHAPTER_WORK_MISMATCH");
assert.equal(pageRequests.at(-1), "/chapter/" + chapterId,
  "a foreign work must not reach MangaDex@Home");
relatedId = mangaId;
deliveryLanguage = "pt-br";
await assertPageFailure("CHAPTER_LANGUAGE_MISMATCH");
deliveryLanguage = "en";
externalUrl = "https://publisher.example/read";
await assertPageFailure("EXTERNAL_CHAPTER");
externalUrl = null;
detailFailed = true;
await assertPageFailure("CHAPTER_DETAIL_REQUEST_FAILED");
detailFailed = false;
atHomeFailed = true;
await assertPageFailure("AT_HOME_REQUEST_FAILED");
atHomeFailed = false;
homeBase = "https://untrusted.example";
await assertPageFailure("UNTRUSTED_IMAGE_ORIGIN");
homeBase = "https://uploads.mangadex.org";
atHomeFiles = ["../../leak"];
await assertPageFailure("INVALID_PAGE_METADATA");
atHomeFiles = ["page-one.jpg"];
const readyPages = await pages(pageRequest);
assert.equal(readyPages.type, "page_list");
assert.equal(readyPages.pages.length, 1);
assert.equal(readyPages.pages[0].url.startsWith("https://uploads.mangadex.org/data/"), true);
console.log("MangaDex exact work+author verification and source-language chapter coverage OK");
