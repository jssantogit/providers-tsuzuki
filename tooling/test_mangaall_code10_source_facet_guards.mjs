// Independent code10 regression: a foreign-language-only source reply must
// NEVER be reported to the Host as a complete empty requested chapter facet.
// All source responses here are local mocks; no real MangaFire/MangaDot HTTP.
import assert from "node:assert/strict";
import { chapters as dotChapters } from "../providers/mangaall/modules/sources/mangadot/modules/mangadot.js";
import fire from "../providers/mangaall/modules/sources/mangafire/main.js";

const envelope = value => JSON.stringify({
  statusCode: 200, body: JSON.stringify(value),
});
let dotRows = [];
let fireRows = [];
let calls = [];
globalThis.tsuzuki = {
  http: { async request(method, raw) {
    const url = new URL(raw);
    assert.equal(method, "GET");
    assert.ok(["https://mangadot.net", "https://mangafire.to"].includes(url.origin));
    calls.push(url.pathname);
    if (url.origin === "https://mangadot.net") {
      assert.equal(url.pathname, "/api/manga/317/chapters/list");
      assert.equal(url.searchParams.get("lang"), "en");
      return envelope(dotRows);
    }
    if (url.pathname === "/api/titles") {
      return envelope({ items: [
        { hid: "first", title: "Example" },
        { hid: "second", title: "Example" },
      ] });
    }
    if (["/api/titles/first", "/api/titles/second"].includes(url.pathname)) {
      const hid = url.pathname.split("/").at(-1);
      return envelope({ data: { hid, title: "Example", authors: ["Verified Creator"] } });
    }
    if (["/api/titles/first/chapters", "/api/titles/second/chapters"].includes(url.pathname)) {
      assert.equal(url.searchParams.get("language"), "en");
      return envelope({ items: fireRows, meta: { hasNext: false, lastPage: 1 } });
    }
    throw Error("Unexpected mocked source endpoint: " + url.pathname);
  } },
};

const dotBinding = { binding: { externalWorkId: "mangadot:317", facetId: "en" } };
dotRows = [{ id: 41, chapter_number: "1", language: "pt-br" }];
await assert.rejects(dotChapters(dotBinding), /chapter language mismatch/i,
  "foreign-only MangaDot source must stay inconclusive, never EMPTY");
dotRows = [{ id: 41, chapter_number: "1", language: 123 }];
await assert.rejects(dotChapters(dotBinding), /chapter language mismatch/i,
  "an invalid language DTO cannot become a successful empty source");
dotRows = [
  { id: 41, chapter_number: "1", language: "pt-br" },
  { id: 42, chapter_number: "2", language: "en" },
  { id: 43, chapter_number: "3", language: null },
];
const dotMixed = await dotChapters(dotBinding);
assert.deepEqual(dotMixed.items.map(item => [item.providerChapterId, item.language]), [
  ["mangadot:uploads:42", "en"], ["mangadot:uploads:43", null],
]);
assert.equal(dotMixed.nextCursor, null);
dotRows = [];
assert.deepEqual(await dotChapters(dotBinding), { items: [], nextCursor: null },
  "genuine empty source remains a valid empty source");
const dotCalls = calls.length;
assert.equal(dotCalls, 4, "MangaDot must not retry, fetch another facet or bypass upstream");

const fireBinding = { binding: { externalWorkId: "first", facetId: "en" } };
fireRows = [{ id: 121, number: 1, name: "Chapter 1", language: "fr" }];
await assert.rejects(fire.reading.chapters(fireBinding), /chapters language mismatch/i,
  "MangaFire foreign-only chapter list must not become a complete-empty catalog");
fireRows = [
  { id: 121, number: 1, language: "fr" },
  { id: 122, number: 2, language: "en", name: "Chapter 2" },
];
const fireMixed = await fire.reading.chapters(fireBinding);
assert.deepEqual(fireMixed.items.map(item => [item.providerChapterId, item.language]), [
  ["122", "en"],
]);
fireRows = [];
assert.deepEqual(await fire.reading.chapters(fireBinding), { items: [], nextCursor: null });

fireRows = [{ id: 321, number: 3, language: "fr", name: "Chapter 3" }];
const badCoverage = await fire.reading.lookup({
  titles: ["Example"], requestedLanguage: "en",
  editorialEvidenceVersion: 1, coverageEvidenceVersion: 1,
});
assert.equal(badCoverage.items.length, 2);
assert.deepEqual(badCoverage.items.map(item => item.coverageOutcome),
  ["INVALID_RESPONSE", "INVALID_RESPONSE"],
  "a foreign-language-only source preview cannot authoritatively attest EMPTY English coverage");
assert.equal(badCoverage.items.every(item => !item.bindingEligible && !item.editorialIdentityVerified), true);

fireRows = [];
const emptyCoverage = await fire.reading.lookup({
  titles: ["Example"], requestedLanguage: "en",
  editorialEvidenceVersion: 1, coverageEvidenceVersion: 1,
});
assert.deepEqual(emptyCoverage.items.map(item => item.coverageOutcome),
  ["EMPTY", "EMPTY"], "only an actually empty upstream page can attest source EMPTY");

fireRows = [{ id: 322, number: 4, language: "en", name: "Chapter 4" }];
const observedCoverage = await fire.reading.lookup({
  titles: ["Example"], requestedLanguage: "en",
  editorialEvidenceVersion: 1, coverageEvidenceVersion: 1,
});
assert.deepEqual(observedCoverage.items.map(item => item.coverageOutcome),
  ["OBSERVED", "OBSERVED"], "valid English coverage remains observable");
assert.equal(observedCoverage.items.every(item => item.coverageObservedCount === 1), true);
assert.ok(calls.every(item => !item.startsWith("http:")),
  "only the two real source origins and fixed endpoints can be queried");
console.log("MangaALL code10 MangaDot+MangaFire foreign-facet false-empty guards PASS (offline)");
