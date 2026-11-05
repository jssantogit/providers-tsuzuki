import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mangaId = "11111111-2222-4333-8444-555555555555";
const chapterId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let detailId = mangaId;
let creator = "Takehiko Inoue";
let translatedLanguage = "en";
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
    }] });
  }
  throw Error("Unexpected API path: " + parsed.pathname);
}}};
const { lookup } = await import(pathToFileURL(path.resolve(
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

translatedLanguage = "pt-br";
const portuguese = (await lookup(request("pt-br"))).items[0];
assert.equal(portuguese.coverageOutcome, "OBSERVED");
const enMismatch = (await lookup(request("en"))).items[0];
assert.notEqual(enMismatch.coverageOutcome, "OBSERVED",
  "a Portuguese-only page is not an English coverage attestation");
const before = chapterCalls;
await lookup({ titles: ["Vagabond"], editorialEvidenceVersion: 1, coverageEvidenceVersion: 1 });
assert.equal(chapterCalls, before, "unknown facet must never get cross-language coverage");
console.log("MangaDex exact work+author verification and source-language chapter coverage OK");
