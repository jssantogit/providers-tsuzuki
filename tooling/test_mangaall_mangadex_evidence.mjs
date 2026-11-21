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
const { lookup, chapters, pages } = await import(pathToFileURL(path.resolve(
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

// Regression #90: only source-attested, exact-work/facet, hosted numbered
// releases count. The published code9 sampled two rows, missing later chapters.
const sampleChapter = (id, number, extras = {}) => ({
  type: "chapter", id,
  attributes: { chapter: number, translatedLanguage: "en", ...extras.attributes },
  relationships: extras.relationships ?? [{ type: "manga", id: mangaId }],
});
const extraChapterId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const externalChapter = (n) => sampleChapter(
  "aaaaaaaa-bbbb-4ccc-8ddd-" + n.toString(16).padStart(12, "0"),
  String(n), { attributes: { externalUrl: "https://publisher.example/read" } },
);
async function runCoverageScenario(pages) {
  const chapterOffsets = [];
  let nextPage = 0;
  globalThis.tsuzuki = { http: { async request(method, url) {
    assert.equal(method, "GET");
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.mangadex.org");
    if (parsed.pathname === "/manga") {
      return response({ offset: 0, total: 1, data: [{
        type: "manga", id: mangaId,
        attributes: { title: { en: "Vagabond" }, altTitles: [] },
      }] });
    }
    if (parsed.pathname === "/manga/" + mangaId) {
      return response({ data: {
        type: "manga", id: mangaId,
        attributes: { title: { en: "Vagabond" }, altTitles: [] },
        relationships: [{ type: "author",
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          attributes: { name: "Takehiko Inoue" } }],
      } });
    }
    if (parsed.pathname === "/chapter") {
      assert.equal(parsed.searchParams.get("manga"), mangaId);
      assert.deepEqual(parsed.searchParams.getAll("translatedLanguage[]"), ["en"]);
      assert.deepEqual(parsed.searchParams.getAll("contentRating[]"), ["safe", "suggestive"]);
      const offset = Number(parsed.searchParams.get("offset"));
      const limit = Number(parsed.searchParams.get("limit"));
      assert.equal(limit, 12, "chapter preview must have a strict small page limit");
      assert.equal(offset, nextPage * limit, "preview cursor must progress monotonically");
      chapterOffsets.push(offset);
      assert.ok(chapterOffsets.length <= 2, "never exceed the read-only probe budget");
      const item = pages[nextPage++];
      if (item instanceof Error) throw item;
      assert.ok(item, "unexpected third preview request");
      return response(item);
    }
    throw new Error("unexpected test route");
  } } };
  return {
    chapterOffsets,
    candidate: (await lookup(request("en"))).items[0],
  };
}

const firstTwelveExternal = Array.from({ length: 12 }, (_, index) =>
  index < 2 ? externalChapter(index + 1) :
    sampleChapter("dddddddd-dddd-4ddd-8ddd-" + (index + 1).toString(16).padStart(12, "0"), null));
const laterHosted = await runCoverageScenario([
  { offset: 0, total: 13, data: firstTwelveExternal },
  { offset: 12, total: 13, data: [sampleChapter(extraChapterId, "336")] },
]);
assert.deepEqual(laterHosted.chapterOffsets, [0, 12]);
assert.equal(laterHosted.candidate.coverageOutcome, "OBSERVED");
assert.equal(laterHosted.candidate.coverageObservedCount, 1);
assert.equal(laterHosted.candidate.coverageMinMilli, 336000);
assert.equal(laterHosted.candidate.coverageMaxMilli, 336000);
assert.equal(laterHosted.candidate.coverageHasMore, false);
assert.deepEqual(laterHosted.candidate.authors, ["Takehiko Inoue"]);

const onePagePositive = await runCoverageScenario([{
  offset: 0, total: 120, data: [sampleChapter(extraChapterId, "1")],
}]);
assert.deepEqual(onePagePositive.chapterOffsets, [0], "positive first page must not spawn extra HTTP");
assert.equal(onePagePositive.candidate.coverageOutcome, "OBSERVED");
assert.equal(onePagePositive.candidate.coverageHasMore, true);

const noHostedInBudget = await runCoverageScenario([
  { offset: 0, total: 35, data: firstTwelveExternal },
  { offset: 12, total: 35, data: firstTwelveExternal },
]);
assert.deepEqual(noHostedInBudget.chapterOffsets, [0, 12]);
assert.equal(noHostedInBudget.candidate.coverageOutcome, "UNKNOWN",
  "the source may have hosted chapters after the sampled window");
assert.equal(noHostedInBudget.candidate.coverageObservedCount ?? 0, 0);

const trueEmpty = await runCoverageScenario([{ offset: 0, total: 0, data: [] }]);
assert.deepEqual(trueEmpty.chapterOffsets, [0]);
assert.equal(trueEmpty.candidate.coverageOutcome, "EMPTY");
assert.equal(trueEmpty.candidate.coverageHasMore, false);

for (const [reason, entry] of [
  ["foreign-work", sampleChapter(extraChapterId, "4", {
    relationships: [{ type: "manga", id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }],
  })],
  ["foreign-facet", sampleChapter(extraChapterId, "4", { attributes: { translatedLanguage: "pt-br" } })],
  ["external", sampleChapter(extraChapterId, "4", { attributes: { externalUrl: "https://publisher.example/owned" } })],
  ["unnumbered", sampleChapter(extraChapterId, null)],
  ["non-numeric", sampleChapter(extraChapterId, "Episode Five")],
]) {
  const result = await runCoverageScenario([{ offset: 0, total: 1, data: [entry] }]);
  assert.equal(result.candidate.coverageOutcome, "UNKNOWN", reason);
  assert.deepEqual(result.chapterOffsets, [0], reason);
}
for (const [reason, first, second] of [
  ["wrong-offset", { offset: 99, total: 1, data: [sampleChapter(extraChapterId, "4")] }],
  ["missing-array", { offset: 0, total: 1, data: null }],
  ["short-total", { offset: 0, total: 0, data: [sampleChapter(extraChapterId, "4")] }],
  ["nonadvancing-page", { offset: 0, total: 2, data: [] }],
  ["second-offset-conflict", { offset: 0, total: 13, data: firstTwelveExternal },
    { offset: 11, total: 13, data: [sampleChapter(extraChapterId, "4")] }],
  ["second-total-conflict", { offset: 0, total: 13, data: firstTwelveExternal },
    { offset: 12, total: 14, data: [sampleChapter(extraChapterId, "4")] }],
]) {
  const result = await runCoverageScenario([first, second].filter(Boolean));
  assert.equal(result.candidate.coverageOutcome,
    reason === "missing-array" ? "FAILED" : "INVALID_RESPONSE", reason);
}
const timeout = await runCoverageScenario([
  { offset: 0, total: 13, data: firstTwelveExternal },
  new Error("Private upstream timeout text must never be trusted"),
]);
assert.equal(timeout.candidate.coverageOutcome, "FAILED");
assert.deepEqual(timeout.chapterOffsets, [0, 12]);
assert.ok(!JSON.stringify(timeout.candidate).includes("Private upstream"));
const rateLimit = await runCoverageScenario([new Error("HTTP 429 sensitive upstream body")]);
assert.equal(rateLimit.candidate.coverageOutcome, "FAILED");
assert.deepEqual(rateLimit.chapterOffsets, [0]);

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
// Independent code10 release audit: /chapter?manga=ID is a query filter,
 // NOT independent attestation that every returned chapter belongs to ID.
 // The old candidate silently accepted another work's chapter and would
 // produce a valid-looking providerChapterId for the wrong manga. This test
 // exercises the ACTUAL MangaDex source adapter, not a mock router.
const sourceBinding = { externalWorkId: "mangadex:" + mangaId, facetId: "en" };
const validChapter = (overrides = {}) => ({
  id: chapterId, type: "chapter",
  attributes: { chapter: "1", translatedLanguage: "en" },
  relationships: [{ type: "manga", id: mangaId }],
  ...overrides,
});
let requestedFeed = [];
let chapterFeedCalls = 0;
globalThis.tsuzuki = { http: { async request(method, url) {
  assert.equal(method, "GET");
  const query = new URL(url);
  assert.equal(query.origin, "https://api.mangadex.org");
  assert.equal(query.pathname, "/chapter");
  assert.equal(query.searchParams.get("manga"), mangaId);
  assert.equal(query.searchParams.getAll("translatedLanguage[]")[0], "en");
  assert.deepEqual(query.searchParams.getAll("includes[]"), ["scanlation_group"]);
  chapterFeedCalls++;
  return response({ offset: 0, total: requestedFeed.length, data: requestedFeed });
} } };
const matchingFeed = [validChapter()];
requestedFeed = matchingFeed;
const verifiedList = await chapters({ binding: sourceBinding });
assert.deepEqual(verifiedList.items.map(x => x.providerChapterId), ["mangadex:" + chapterId]);
assert.equal(verifiedList.nextCursor, null);
assert.equal(verifiedList.items[0].rawNumber, 1);
for (const [reason, data] of [
  ["wrong-work", [validChapter({ relationships: [{
    type: "manga", id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  }] })]],
  ["missing-work-relationship", [validChapter({ relationships: [{
    type: "scanlation_group", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  }] })]],
  ["missing-relationships", [validChapter({ relationships: undefined })]],
  ["wrong-language", [validChapter({ attributes: { chapter: "1", translatedLanguage: "pt-br" } })]],
  ["mixed-healthy-foreign", [...matchingFeed, validChapter({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    relationships: [{ type: "manga", id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }],
  })]],
  ["foreign-unnumbered", [validChapter({
    attributes: { chapter: null, translatedLanguage: "en" },
    relationships: [{ type: "manga", id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }],
  })]],
]) {
  requestedFeed = data;
  await assert.rejects(chapters({ binding: sourceBinding }),
    /chapter (?:work mismatch|language mismatch)|invalid chapter response/,
    "reject entire cross-work/facet page: " + reason);
}
requestedFeed = [validChapter({ attributes: { chapter: null, translatedLanguage: "en" } })];
const unnumbered = await chapters({ binding: sourceBinding });
assert.deepEqual(unnumbered.items, [], "valid unnumbered source chapters cannot invent ordinal numbers");
requestedFeed = [];
const emptySource = await chapters({ binding: sourceBinding });
assert.deepEqual(emptySource, { items: [], nextCursor: null });
assert.equal(chapterFeedCalls, 9, "no extra upstream HTTP retries or backdoor chapter/detail lookup");

console.log("MangaDex exact work+author verification and source-language chapter coverage OK");
