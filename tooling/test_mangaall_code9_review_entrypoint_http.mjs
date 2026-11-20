// Execute the REAL review-derived MangaAll code9 main.js with one three-source
// lookup against synthetic HTTP, including a single challenged source.
// No real network, signing, browser fallback, Reader or source identity grant.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const source = path.resolve(process.argv[2] ?? "");
const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
assert.equal(manifest.version.name, "0.5.4");
assert.equal(manifest.version.code, 9);
assert.equal(manifest.publication, "development");
fs.writeFileSync(path.join(source, "package.json"), '{"type":"module"}\n');

const origins = [
  "https://api.mangadex.org", "https://mangadot.net", "https://mangafire.to",
];
const statuses = [];
let block = null;
globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson) {
      assert.equal(method, "GET");
      const uri = new URL(url);
      assert.ok(origins.includes(uri.origin), "Unexpected unapproved network origin");
      assert.ok(JSON.parse(headersJson).Accept);
      statuses.push(uri.origin);
      if (uri.origin === block) {
        return JSON.stringify({ statusCode: 403, body: "synthetic forbidden" });
      }
      if (uri.origin === origins[0] && uri.pathname === "/manga")
        return JSON.stringify({ statusCode: 200,
          body: JSON.stringify({ result: "ok", data: [], offset: 0, limit: 25, total: 0 }) });
      if (uri.origin === origins[1] && uri.pathname === "/api/search")
        return JSON.stringify({ statusCode: 200, body: JSON.stringify({ results: [] }) });
      if (uri.origin === origins[2] && uri.pathname === "/api/titles")
        return JSON.stringify({ statusCode: 200, body: JSON.stringify({ items: [] }) });
      throw Error("Unexpected synthetic endpoint");
    },
  },
};
const { default: { reading } } = await import(pathToFileURL(path.join(source, "main.js")).href);
const input = { titles: ["Naruto"], requestedLanguage: "en" };
assert.equal(typeof reading.lookup, "function");
assert.equal(typeof reading.chapters, "function");
assert.equal(typeof reading.pages, "function");

const v1 = await reading.lookup(input);
assert.ok(Array.isArray(v1.items));
assert.equal(Object.hasOwn(v1, "contractVersion"), false);
statuses.length = 0;
const allHealthy = await reading.lookup({ ...input, diagnosticsVersion: 2 });
assert.deepEqual([...new Set(statuses)].sort(), [...origins].sort(),
  "MangaDex, MangaDot, MangaFire must run in ONE MangaAll call");
assert.equal(allHealthy.contractVersion, 2);
assert.equal(allHealthy.provenance, "V2_READONLY_OBSERVATION");
assert.equal(allHealthy.lookupComplete, true);
assert.equal(allHealthy.eligibleForReader, false);
assert.equal(allHealthy.eligibleForCanonicalBinding, false);
assert.equal(Object.hasOwn(allHealthy, "items"), false);
assert.equal(Object.hasOwn(allHealthy, "hostProvenance"), false);
assert.deepEqual(allHealthy.sourceStatuses.map(item => item.source),
  ["mangadex", "mangadot", "mangafire"]);

block = "https://mangadot.net";
statuses.length = 0;
const partial = await reading.lookup({ ...input, diagnosticsVersion: 2 });
assert.deepEqual([...new Set(statuses)].sort(), [...origins].sort(),
  "A blocked adapter must not prevent other adapters from executing");
assert.equal(partial.lookupComplete, false);
assert.equal(partial.sourceStatuses[0].status, "SUCCESS_PAGE");
assert.equal(partial.sourceStatuses[1].status, "FAILED");
assert.equal(partial.sourceStatuses[1].failure?.code, "CHALLENGE_BLOCKED");
assert.equal(partial.sourceStatuses[1].failure?.httpStatus, 403);
assert.equal(partial.sourceStatuses[2].status, "SUCCESS_PAGE");
assert.equal(partial.eligibleForReader, false);
assert.equal(partial.eligibleForCanonicalBinding, false);
assert.equal(partial.canContinue, true);

statuses.length = 0;
const retry = await reading.lookup({ ...input, diagnosticsVersion: 2,
  cursor: partial.continuationCursor });
assert.deepEqual(statuses, ["https://mangadot.net"],
  "Only failed MangaDot is retried on the next router cursor page");
assert.equal(retry.lookupComplete, false);
assert.equal(retry.canContinue, false);
assert.equal(retry.sourceStatuses[1].failure?.code, "CHALLENGE_BLOCKED");
assert.deepEqual(retry.sourceStatuses.map(v => v.status),
  ["NOT_QUERIED", "FAILED", "NOT_QUERIED"]);

block = null;
assert.ok(Buffer.byteLength(JSON.stringify(partial), "utf8") <= 48 * 1024);
console.log("MANGAALL_CODE9_REVIEW_ENTRYPOINT|v1=COMPATIBLE|v2=NEUTRAL_READONLY|3sources=ONE_LOOKUP|403=SOURCE_SCOPED_AND_BOUNDED|network=SYNTHETIC_ONLY|install=NONE");
