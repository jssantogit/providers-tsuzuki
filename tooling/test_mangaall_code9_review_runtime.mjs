// Offline semantic probe of the REAL reviewed code9 V2 source tree.
// No external source calls, no signatures, no Reader or canonical writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? "");
assert.ok(fs.existsSync(path.join(root, "manifest.json")));
fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.deepEqual(manifest.version, { name: "0.5.4", code: 9 });
assert.equal(manifest.publication, "development");
const { createMangaAllLookupV2Candidate } = await import(
  pathToFileURL(path.join(root, "modules/v2-candidate.js")).href
);

const sources = ["mangadex", "mangadot", "mangafire"];
const largeLabel = "N".repeat(160);
const make = (source, n) => ({
  externalWorkId: source === "mangafire" ? "entry-" + n : source + ":entry-" + n,
  title: "Naruto",
  aliases: Array(20).fill(largeLabel),
  authors: Array(20).fill(largeLabel),
});
const checks = Object.fromEntries(sources.map(s => [s, 0]));
const adapters = Object.fromEntries(sources.map(source => [source, {
  async lookup() {
    checks[source]++;
    return {
      items: Array.from({ length: 32 }, (_, index) => make(source, index)),
      nextCursor: null,
    };
  },
}]));
const request = { titles: ["Naruto"], requestedLanguage: "en", diagnosticsVersion: 2 };
const observation = await createMangaAllLookupV2Candidate(adapters).lookup(request);
assert.equal(Buffer.byteLength(JSON.stringify(observation), "utf8") <= 48 * 1024, true);
assert.deepEqual(checks, { mangadex: 1, mangadot: 1, mangafire: 1 });
assert.equal(observation.provenance, "V2_READONLY_OBSERVATION");
assert.equal(observation.contractVersion, 2);
assert.equal(Object.hasOwn(observation, "items"), false);
assert.equal(Object.hasOwn(observation, "hostProvenance"), false);
assert.equal(observation.lookupComplete, false, "oversize cannot become complete");
assert.equal(observation.state, "PARTIAL_EVIDENCE");
assert.equal(observation.eligibleForReader, false);
assert.equal(observation.eligibleForCanonicalBinding, false);
assert.deepEqual(observation.sourceStatuses.map(x => x.source), sources);
assert.ok(observation.sourceStatuses.some(x => x.observationsTruncated),
  "oversize must visibly mark the affected sources incomplete");
assert.deepEqual(observation.sourceStatuses.map(s => s.observedCandidates),
  sources.map(source => observation.observedCandidates.filter(x => x.source === source).length));
assert.ok(observation.observedCandidates.length < 96);
assert.ok(observation.observedCandidates.every(x =>
  x.editorialIdentityVerified === false && x.bindingEligible === false));

// Real unified V1 router is the same adapter set, not three parallel Providers.
const v1 = await createMangaAllLookupV2Candidate(adapters)
  .lookup({ titles: ["Naruto"], requestedLanguage: "en" });
assert.ok(Array.isArray(v1.items));
assert.equal(Object.hasOwn(v1, "contractVersion"), false);

// A blocked adapter cannot erase observations from healthy adapters.
let dotCalls = 0;
const partial = Object.fromEntries(sources.map(source => [source, {
  lookup: async () => {
    if (source === "mangadot") {
      dotCalls++;
      const failure = new Error("MangaAll HTTP 403");
      failure.httpStatus = 403;
      throw failure;
    }
    return { items: [make(source, 0)], nextCursor: null };
  },
}]));
const reader = createMangaAllLookupV2Candidate(partial);
const first = await reader.lookup(request);
assert.equal(first.state, "PARTIAL_EVIDENCE");
assert.equal(first.canContinue, true);
assert.equal(first.sourceStatuses[1].status, "FAILED");
assert.deepEqual(first.sourceStatuses[1].failure, {
  code: "CHALLENGE_BLOCKED", httpStatus: 403, retryable: true,
});
assert.deepEqual(first.observedCandidates.map(x => x.source), ["mangadex", "mangafire"]);
assert.equal(first.eligibleForReader, false);
const retry = await reader.lookup({ ...request, cursor: first.continuationCursor });
assert.equal(dotCalls, 2);
assert.equal(retry.canContinue, false);
assert.equal(retry.lookupComplete, false);
assert.equal(retry.sourceStatuses[1].status, "FAILED");
assert.deepEqual(retry.observedCandidates, []);
console.log("MANGAALL_CODE9_REVIEW_RUNTIME|wire=V2_READONLY_OBSERVATION|v1=PRESERVED|3sources=ONE_ROUTER|payload=BOUNDED_48K|403=ATTRIBUTED|trust=NOT_ATTESTED|network=OFFLINE");
