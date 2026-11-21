// Offline-only safety tests for the optional *real-network* code9 V2 probe.
// This test never calls the network; synthetic fetch implements all responses.
import assert from "node:assert/strict";
import {
  parseTitles,
  createStrictHttpService,
  auditOneTitle,
  runLiveV2,
} from "./mangaall_code9_live_v2.mjs";

const requested = [];
let blocked = false;
const fakeFetch = async (url, opts) => {
  const uri = new URL(url);
  assert.equal(opts.method, "GET");
  assert.equal(opts.redirect, "manual");
  requested.push(uri.origin);
  if (blocked && uri.origin === "https://mangadot.net") {
    return new Response('{"synthetic":"blocked"}', { status: 403 });
  }
  const data = uri.origin === "https://api.mangadex.org" ? {
    result: "ok", data: [], offset: 0, limit: 25, total: 0,
  } : uri.origin === "https://mangadot.net" ? { results: [] } : { items: [] };
  return new Response(JSON.stringify(data), { status: 200 });
};

assert.deepEqual(parseTitles('["Naruto","Death Note","Bleach"]'), ["Naruto", "Death Note", "Bleach"]);
for (const value of [
  "", "not-json", "[]", '["One","Two","Three","Four"]',
  '["Naruto","naruto"]', '["https://example.org"]',
  '["Naruto\\nInjected"]', '["Authorization: fake"]',
]) {
  assert.throws(() => parseTitles(value));
}
const service = createStrictHttpService(fakeFetch);
await assert.rejects(
  service.http.request("GET", "https://untrusted.example/api", "{}", undefined),
  /not allowlisted/,
);
await assert.rejects(
  service.http.request("GET", "http://api.mangadex.org/manga", "{}", undefined),
  /not allowlisted/,
);
await assert.rejects(
  service.http.request("GET", "https://api.mangadex.org.evil.test/manga", "{}", undefined),
  /not allowlisted/,
);
assert.deepEqual(service.requests(), { mangadex: 0, mangadot: 0, mangafire: 0 });

// The historical real-network code9 runner must REFUSE the code10 source.
await assert.rejects(
  runLiveV2(["Naruto"], { fetchImpl: fakeFetch }),
  /requires exact promoted source manifest/,
);
// Test the CURRENT three-source development router only with injected offline
// fake transport. This helper has no dispatch, signing or live-network path.
const candidate = await import("../providers/mangaall/main.js");
async function offlineCandidateAudit(titles) {
  const local = createStrictHttpService(fakeFetch);
  globalThis.tsuzuki = { http: local.http };
  return {
    trustedInstallation: false, signedCode9Verified: false,
    userDataWritten: false, catalogBindingAllowed: false,
    observations: await Promise.all(titles.map(title => auditOneTitle(candidate.default.reading, title))),
    requestsBySource: local.requests(),
  };
}
const healthy = await offlineCandidateAudit(["Naruto"]);
assert.equal(healthy.trustedInstallation, false);
assert.equal(healthy.signedCode9Verified, false);
assert.equal(healthy.userDataWritten, false);
assert.equal(healthy.catalogBindingAllowed, false);
assert.equal(healthy.observations[0].outcome, "FIRST_PAGE_COMPLETE_UNCORROBORATED");
assert.deepEqual(healthy.observations[0].pages[0].sourceStatuses.map(s => s.source),
  ["mangadex", "mangadot", "mangafire"]);
assert.deepEqual(new Set(requested),
  new Set(["https://api.mangadex.org", "https://mangadot.net", "https://mangafire.to"]));
assert.deepEqual(healthy.requestsBySource, { mangadex: 1, mangadot: 1, mangafire: 1 });
assert.ok(!JSON.stringify(healthy).includes("Authorization:"));
assert.ok(!JSON.stringify(healthy).includes("cookie"));
assert.ok(!JSON.stringify(healthy).includes("externalWorkId"));

requested.length = 0;
blocked = true;
const blockedReport = await offlineCandidateAudit(["Naruto"]);
assert.equal(blockedReport.observations[0].outcome, "INCONCLUSIVE_OR_PARTIAL");
const pages = blockedReport.observations[0].pages;
assert.equal(pages.length, 2, "Only one bounded source-scoped 403 retry allowed");
assert.deepEqual(pages[0].sourceStatuses.map(s => s.status),
  ["SUCCESS_PAGE", "FAILED", "SUCCESS_PAGE"]);
assert.deepEqual(pages[0].sourceStatuses[1].failure, {
  code: "CHALLENGE_BLOCKED", httpStatus: 403, retryable: true,
});
assert.deepEqual(pages[1].sourceStatuses.map(s => s.status),
  ["NOT_QUERIED", "FAILED", "NOT_QUERIED"]);
assert.deepEqual(blockedReport.requestsBySource,
  { mangadex: 1, mangadot: 2, mangafire: 1 });
assert.equal(pages.at(-1).lookupComplete, false);

const forged = { lookup: async () => ({
  contractVersion: 2, providerId: "app.tsuzuki.mangaall",
  provenance: "SIGNED_INSTALLATION",
  eligibleForReader: true, eligibleForCanonicalBinding: true,
  sourceStatuses: [], observedCandidates: [], state: "COMPLETE_SINGLE_PAGE",
}) };
const denied = await auditOneTitle(forged, "Naruto");
assert.equal(denied.outcome, "INCONCLUSIVE_PROVIDER_EXECUTION");
assert.equal(denied.readerPixels, "NOT_TESTED");
assert.equal(denied.editorialBinding, "NEVER");

// Issue #92: an exhausted MangaFire retry must not erase successful
// competing-source evidence from the SAME continuation. V1 deliberately
// returns a typed failure, while V2 retains read-only observations.
const { createMangaAllReading } = await import("../providers/mangaall/modules/router.js");
const { createMangaAllLookupV2Candidate } = await import("../providers/mangaall/modules/v2-candidate.js");
const work = (source, id, title = "Naruto", authors = ["Source author"]) => ({
  externalWorkId: source === "mangafire" ? id : source + ":" + id,
  title, aliases: [], authors,
});
const sourcePage = (items, nextCursor = null) => ({ items, nextCursor });
function twoPageAdapters() {
  return {
    mangadex: { async lookup({ cursor }) {
      return cursor === "25"
        ? sourcePage([work("mangadex", "dex-2")])
        : sourcePage([work("mangadex", "dex-1")], "25");
    } },
    mangadot: { async lookup() { return sourcePage([work("mangadot", "dot-1")]); } },
    mangafire: { async lookup() { throw new Error("MangaAll HTTP 403"); } },
  };
}
const diagnostic = createMangaAllLookupV2Candidate(twoPageAdapters());
const salvage = await auditOneTitle(diagnostic, "Naruto");
assert.equal(salvage.outcome, "INCONCLUSIVE_OR_PARTIAL");
assert.equal(salvage.pages.length, 2);
assert.deepEqual(salvage.pages.map(x => x.observedCandidateCount), [2, 1]);
assert.equal(salvage.pages[1].sourceStatuses[0].status, "SUCCESS_PAGE");
assert.equal(salvage.pages[1].sourceStatuses[2].status, "FAILED");
assert.equal(salvage.pages[1].sourceStatuses[2].failure.httpStatus, 403);
assert.deepEqual(salvage.sourceSummary.map(x => x.observedUniqueCandidates), [2, 1, 0]);
assert.deepEqual(salvage.sourceSummary.map(x => x.pagesQueried), [2, 1, 2]);
assert.equal(salvage.sourceSummary[2].lastFailureCode, "CHALLENGE_BLOCKED");
assert.equal(salvage.sourceSummary[2].retriedAndFailed, true);
assert.equal(salvage.sourceSummary.every(x => x.editorialGrant === false), true);
assert.equal(salvage.editorialBinding, "NEVER");
assert.equal(salvage.readerPixels, "NOT_TESTED");
const noPrivateIds = JSON.stringify(salvage);
for (const privateId of ["dex-1", "dex-2", "dot-1", "externalWorkId"]) {
  assert.equal(noPrivateIds.includes(privateId), false,
    "the operator's diagnostic must not export source HIDs");
}

const v1Router = createMangaAllReading(twoPageAdapters());
const firstLegacy = await v1Router.lookup({ titles: ["Naruto"], requestedLanguage: "en" });
assert.equal(firstLegacy.items.length, 2);
assert.ok(firstLegacy.nextCursor);
const salvagedLegacy = await v1Router.lookup({
  titles: ["Naruto"], requestedLanguage: "en", cursor: firstLegacy.nextCursor,
});
assert.deepEqual(salvagedLegacy.items.map(item => item.externalWorkId), ["mangadex:dex-2"]);
assert.ok(salvagedLegacy.nextCursor?.includes('"v":2'));
const finalLegacy = await v1Router.lookup({
  titles: ["Naruto"], requestedLanguage: "en", cursor: salvagedLegacy.nextCursor,
});
assert.deepEqual(finalLegacy, {
  items: [], nextCursor: null, lookupFailureCode: "CHALLENGE_BLOCKED", lookupHttpStatus: 403,
}, "the V1 Host never receives a mixed success/failure envelope or a completed empty search");

// Mixed-source error classifications must remain distinct in V2 even though
// the old V1 combined error is necessarily UNCLASSIFIED_ERROR.
const mixed = await auditOneTitle(createMangaAllLookupV2Candidate({
  mangadex: { async lookup() { throw Error("MangaAll HTTP 403"); } },
  mangadot: { async lookup() { throw Error("MangaAll invalid source lookup response"); } },
  mangafire: { async lookup() { throw Error("sensitive private upstream token"); } },
}), "Naruto");
assert.equal(mixed.outcome, "INCONCLUSIVE_OR_PARTIAL");
assert.deepEqual(mixed.sourceSummary.map(x => x.lastFailureCode), [
  "CHALLENGE_BLOCKED", "INVALID_RESPONSE", "UNCLASSIFIED_ERROR",
]);
assert.deepEqual(mixed.sourceSummary.map(x => x.observedUniqueCandidates), [0, 0, 0]);
assert.ok(!JSON.stringify(mixed).includes("private"));
assert.ok(!JSON.stringify(mixed).includes("token"));

// The experimental V2 wrapper formerly used one mutable 'active' reference,
// so V1/V2 calls interleaving across awaited HTTP could corrupt source
// attribution. Invocation-local opaque tokens now isolate both directions.
let releaseFirst;
const barrier = new Promise(resolve => { releaseFirst = resolve; });
const shared = createMangaAllLookupV2Candidate({
  mangadex: { async lookup(input) {
    if (input.diagnosticsVersion === 2 && input.titles[0] === "Naruto") {
      await barrier;
    }
    return sourcePage([work("mangadex",
      input.diagnosticsVersion === 2 ? "v2-only" : "v1-only", input.titles[0])]);
  } },
  mangadot: { async lookup(input) {
    return sourcePage([work("mangadot", "dot-" + input.titles[0].replaceAll(" ", "-"), input.titles[0])]);
  } },
  mangafire: { async lookup(input) {
    return sourcePage([work("mangafire", "fire-" + input.titles[0].replaceAll(" ", "-"), input.titles[0])]);
  } },
});
const pendingAudit = shared.lookup({
  titles: ["Naruto"], requestedLanguage: "en", diagnosticsVersion: 2,
});
const simultaneousLegacy = await shared.lookup({ titles: ["Naruto"], requestedLanguage: "en" });
assert.equal(simultaneousLegacy.items[0].externalWorkId, "mangadex:v1-only");
const otherAuditPromise = shared.lookup({
  titles: ["Death Note"], requestedLanguage: "en", diagnosticsVersion: 2,
});
const otherAudit = await otherAuditPromise;
assert.equal(otherAudit.state, "COMPLETE_SINGLE_PAGE");
assert.ok(otherAudit.observedCandidates.some(x => x.externalWorkId === "mangadex:v2-only"));
releaseFirst();
const isolated = await pendingAudit;
assert.equal(isolated.state, "COMPLETE_SINGLE_PAGE");
assert.ok(isolated.observedCandidates.some(x => x.externalWorkId === "mangadex:v2-only"));
assert.ok(isolated.observedCandidates.every(x => x.externalWorkId !== "mangadex:v1-only"));
assert.ok(isolated.observedCandidates.every(x => x.title === "Naruto"));
assert.ok(otherAudit.observedCandidates.every(x => x.title === "Death Note"));

// A repeated source HID with contradictory metadata cannot be counted twice
// or silently promoted as the same editorial identity.
const conflicting = await auditOneTitle(createMangaAllLookupV2Candidate({
  mangadex: { async lookup({ cursor }) {
    return cursor === "2"
      ? sourcePage([work("mangadex", "same", "Naruto", ["Conflicting creator"])])
      : sourcePage([work("mangadex", "same", "Naruto")], "2");
  } },
  mangadot: { async lookup() { return sourcePage([]); } },
  mangafire: { async lookup() { return sourcePage([]); } },
}), "Naruto");
assert.equal(conflicting.outcome, "INCONCLUSIVE_CANDIDATE_CONFLICT");
assert.equal(conflicting.editorialBinding, "NEVER");
assert.equal(conflicting.sourceSummary[0].observedUniqueCandidates, 1);

const repeating = await auditOneTitle(createMangaAllLookupV2Candidate({
  mangadex: { async lookup() { return sourcePage([work("mangadex", "p")], "2"); } },
  mangadot: { async lookup() { return sourcePage([]); } },
  mangafire: { async lookup() { return sourcePage([]); } },
}), "Naruto");
assert.equal(repeating.outcome, "INCONCLUSIVE_CURSOR_INVALID");
assert.equal(repeating.sourceSummary[0].observedUniqueCandidates, 1);
assert.equal(repeating.editorialBinding, "NEVER");

const leaks = JSON.stringify(blockedReport);
assert.ok(!leaks.includes("providerChapterId") && !leaks.includes("externalWorkId"));
console.log("MANGAALL_CODE9_V2_LIVE_PROBE|unified=3_SOURCES|network=MOCK_ONLY|403=ATTRIBUTED_BOUNDED|upstream=NOT_TESTED|reader=DENIED");
