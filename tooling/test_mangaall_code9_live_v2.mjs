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

const healthy = await runLiveV2(["Naruto"], { fetchImpl: fakeFetch });
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
const blockedReport = await runLiveV2(["Naruto"], { fetchImpl: fakeFetch });
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

const leaks = JSON.stringify(blockedReport);
assert.ok(!leaks.includes("providerChapterId") && !leaks.includes("externalWorkId"));
console.log("MANGAALL_CODE9_V2_LIVE_PROBE|unified=3_SOURCES|network=MOCK_ONLY|403=ATTRIBUTED_BOUNDED|upstream=NOT_TESTED|reader=DENIED");
