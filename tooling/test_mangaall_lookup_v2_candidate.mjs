// Offline adversarial contract tests for the UNSIGNED, unshipped V2 candidate.
// This is NOT a live network / signed code9 / Host or Reader acceptance gate.
import assert from "node:assert/strict";
import { createMangaAllReading } from "../providers/mangaall/modules/router.js";
import { createMangaAllLookupV2Candidate, SOURCE_ORDER } from "./mangaall_lookup_v2_candidate.mjs";

const title = "Naruto";
const req = { titles: [title], requestedLanguage: "en", diagnosticsVersion: 2 };
const work = (source, id, display = title, extra = {}) => ({
  externalWorkId: source === "mangafire" ? id : source + ":" + id,
  title: display, aliases: [], authors: ["Author Example"], ...extra,
});
const ok = (items, nextCursor = null) => ({ items, nextCursor });
const blocked = () => Object.assign(new Error("MangaAll HTTP 403"), { httpStatus: 403 });
const adapters = (overrides = {}) => Object.fromEntries(SOURCE_ORDER.map(source => [
  source, { lookup: async () => ok([work(source, source + "-1")]), ...overrides[source] },
]));
const capturedCalls = {};
const counting = (overrides = {}) => {
  for (const key of SOURCE_ORDER) capturedCalls[key] = 0;
  const chosen = adapters(overrides);
  return Object.fromEntries(SOURCE_ORDER.map(source => [source, {
    lookup: async input => {
      capturedCalls[source]++;
      return chosen[source].lookup(input);
    },
  }]));
};

// All three adapters are queried in ONE signed-router fan-out.
let candidate = createMangaAllLookupV2Candidate(counting());
let page = await candidate.lookup(req);
assert.deepEqual(SOURCE_ORDER, ["mangadex", "mangadot", "mangafire"]);
assert.equal(page.contractVersion, 2);
assert.equal(page.providerId, "app.tsuzuki.mangaall");
assert.equal(page.state, "COMPLETE_SINGLE_PAGE");
assert.equal(page.lookupComplete, true);
assert.equal(page.observedCandidates.length, 3);
assert.deepEqual(page.sourceStatuses.map(v => [v.source, v.status, v.pageComplete, v.attempts]), [
  ["mangadex", "SUCCESS_PAGE", true, 1],
  ["mangadot", "SUCCESS_PAGE", true, 1],
  ["mangafire", "SUCCESS_PAGE", true, 1],
]);
assert.deepEqual(Object.values(capturedCalls), [1, 1, 1], "no extra/replayed request");
assert.equal(page.eligibleForCanonicalBinding, false);
assert.equal(page.eligibleForReader, false);
assert.equal(page.observedCandidates.every(v => !v.bindingEligible && !v.editorialIdentityVerified), true);
assert.equal(Object.hasOwn(page, "items"), false, "V2 must not masquerade as a V1 ProviderPage");
assert.equal(page.continuationCursor, null);

// V1 receives the same original router's normal source-scoped candidate IDs.
const v1Adapters = adapters();
const original = await createMangaAllReading(v1Adapters).lookup({ titles: [title], requestedLanguage: "en" });
const v1 = await createMangaAllLookupV2Candidate(v1Adapters).lookup({ titles: [title], requestedLanguage: "en" });
assert.deepEqual(v1, original);
assert.equal(v1.items.length, 3);
assert.deepEqual(v1.items.map(v => v.externalWorkId), [
  "mangadex:mangadex-1", "mangadot:mangadot-1", "mangafire:mangafire-1",
]);

// One 403, one healthy source, one source with TWO exact-title editions.
// Evidence is retained even though the source retry is still pending.
let calls = 0;
candidate = createMangaAllLookupV2Candidate(counting({
  mangadex: { lookup: async () => ok([work("mangadex", "n1")]) },
  mangadot: { lookup: async () => { calls++; throw blocked(); } },
  mangafire: { lookup: async () => ok([
    work("mangafire", "n2"), work("mangafire", "n3", "Naruto One Shot"),
  ]) },
}));
page = await candidate.lookup(req);
assert.equal(page.state, "PARTIAL_EVIDENCE");
assert.equal(page.lookupComplete, false);
assert.equal(page.canContinue, true);
assert.equal(page.observedCandidates.length, 3);
assert.equal(page.sourceStatuses[0].status, "SUCCESS_PAGE");
assert.equal(page.sourceStatuses[1].status, "FAILED");
assert.deepEqual(page.sourceStatuses[1].failure, {
  code: "CHALLENGE_BLOCKED", httpStatus: 403, retryable: true,
});
assert.equal(page.sourceStatuses[2].observedCandidates, 2);
assert.equal(page.eligibleForCanonicalBinding, false);
assert.deepEqual(Object.values(capturedCalls), [1, 1, 1]);
const continuation = page.continuationCursor;
assert.ok(continuation !== null && continuation.length <= 512);
// Retry only the failed MangaDot source; no hidden MangaDex/MangaFire retries.
const next = await candidate.lookup({ ...req, cursor: continuation });
assert.equal(calls, 2);
assert.deepEqual(Object.values(capturedCalls), [1, 2, 1]);
assert.equal(next.state, "INCONCLUSIVE");
assert.equal(next.canContinue, false);
assert.equal(next.lookupComplete, false);
assert.deepEqual(next.sourceStatuses.map(v => v.status), [
  "NOT_QUERIED", "FAILED", "NOT_QUERIED",
]);
assert.equal(next.sourceStatuses[1].failure.httpStatus, 403);
assert.deepEqual(next.observedCandidates, [], "no fabricated healthy candidates from past pages");

// All sources blocked: no invented 'empty catalog' or reader grant.
candidate = createMangaAllLookupV2Candidate(adapters(
  Object.fromEntries(SOURCE_ORDER.map(source => [source, { lookup: async () => { throw blocked(); } }])),
));
page = await candidate.lookup(req);
assert.equal(page.lookupComplete, false);
assert.equal(page.state, "INCONCLUSIVE");
assert.deepEqual(page.sourceStatuses.map(v => v.failure?.code), [
  "CHALLENGE_BLOCKED", "CHALLENGE_BLOCKED", "CHALLENGE_BLOCKED",
]);
assert.deepEqual(page.observedCandidates, []);

// Mixed errors must remain attributed to distinct upstream adapters.
candidate = createMangaAllLookupV2Candidate(adapters({
  mangadex: { lookup: async () => { throw blocked(); } },
  mangadot: { lookup: async () => { throw Error("MangaAll invalid source lookup response"); } },
  mangafire: { lookup: async () => { throw Error("sensitive upstream response / token"); } },
}));
page = await candidate.lookup(req);
assert.deepEqual(page.sourceStatuses.map(v => v.failure?.code), [
  "CHALLENGE_BLOCKED", "INVALID_RESPONSE", "UNCLASSIFIED_ERROR",
]);
assert.ok(!JSON.stringify(page).includes("token"), "raw exceptions must never escape");
assert.ok(!JSON.stringify(page).includes("sensitive"));

// Invalid IDs / unsafe user-visible metadata stay out of the candidate evidence.
candidate = createMangaAllLookupV2Candidate(adapters({
  mangadex: { lookup: async () => ok([work("mangadex", "x", "Naruto", {
    authors: ["Bearer: super-secret-token"],
  })]) },
}));
page = await candidate.lookup(req);
assert.equal(page.sourceStatuses[0].unsafeCandidate, true);
assert.ok(page.state !== "COMPLETE_SINGLE_PAGE");
assert.equal(page.observedCandidates.some(v => v.source === "mangadex"), false);
assert.equal(page.eligibleForReader, false);

// Pagination is never misclassified as a completed source inventory.
candidate = createMangaAllLookupV2Candidate(adapters({
  mangadot: { lookup: async ({ cursor }) =>
    cursor === "2" ? ok([work("mangadot", "b")]) : ok([work("mangadot", "a")], "2") },
}));
page = await candidate.lookup(req);
assert.equal(page.lookupComplete, false);
assert.equal(page.canContinue, true);
assert.equal(page.sourceStatuses[1].pageComplete, false);
const continuation2 = page.continuationCursor;
page = await candidate.lookup({ ...req, cursor: continuation2 });
assert.equal(page.lookupComplete, false,
  "later pages need caller's earlier evidence; a final page alone is not a complete 3-source audit");
assert.deepEqual(page.sourceStatuses.map(v => v.status), [
  "NOT_QUERIED", "SUCCESS_PAGE", "NOT_QUERIED",
]);

// The Portuguese facet does not claim three sources when MangaFire is not supported.
candidate = createMangaAllLookupV2Candidate(adapters());
page = await candidate.lookup({ titles: [title], requestedLanguage: "pt-br", diagnosticsVersion: 2 });
assert.equal(page.lookupComplete, false);
assert.equal(page.sourceStatuses[2].status, "NOT_QUERIED");

console.log("MangaAll UNSIGNED V2 single-router partial-source contract: all adversarial cases PASS (offline)");
