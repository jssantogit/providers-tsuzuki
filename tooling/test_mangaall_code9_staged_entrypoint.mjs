// Validate the actual staged code9 JS entrypoint against SYNTHETIC HTTP ONLY.
// No external requests, publication, signatures, device data or live Reader.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const folder = path.resolve(process.argv[2] ?? "");
assert.ok(folder && fs.existsSync(path.join(folder, "manifest.json")));
fs.writeFileSync(path.join(folder, "package.json"), '{"type":"module"}\n');

const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
assert.equal(manifest.id, "app.tsuzuki.mangaall");
assert.equal(manifest.version.code, 9);
assert.equal(manifest.publication, "development");
const expectedMarker = {
  "0.5.4-dev-unsigned": "UNSIGNED_CANDIDATE_NOT_LIVE",
  "0.5.4-preview-unsigned": "V2_READONLY_OBSERVATION",
}[manifest.version.name];
assert.ok(expectedMarker, "only explicit unsigned code9 modes are testable");

const calls = [];
const ok = data => JSON.stringify({ statusCode: 200, body: JSON.stringify(data) });
const origins = new Set(["https://api.mangadex.org", "https://mangadot.net", "https://mangafire.to"]);
globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson) {
      assert.equal(method, "GET");
      const urlObj = new URL(url);
      assert.ok(origins.has(urlObj.origin), "no unapproved source network request");
      assert.ok(JSON.parse(headersJson).Accept);
      calls.push(urlObj.origin);
      if (urlObj.origin === "https://api.mangadex.org" && urlObj.pathname === "/manga") {
        return ok({ result: "ok", data: [], offset: 0, limit: 25, total: 0 });
      }
      if (urlObj.origin === "https://mangadot.net" && urlObj.pathname === "/api/search") {
        return ok({ results: [] });
      }
      if (urlObj.origin === "https://mangafire.to" && urlObj.pathname === "/api/titles") {
        return ok({ items: [] });
      }
      throw Error("Unexpected synthetic route");
    },
  },
};
const module = await import(pathToFileURL(path.join(folder, "main.js")).href);
const reading = module.default.reading;
assert.equal(typeof reading.lookup, "function");
assert.equal(typeof reading.chapters, "function");
assert.equal(typeof reading.pages, "function");
const request = { titles: ["Naruto"], requestedLanguage: "en" };

const v1 = await reading.lookup(request);
assert.ok(Array.isArray(v1.items), "V1 lookup must preserve its legacy page shape");
assert.equal(Object.hasOwn(v1, "contractVersion"), false);

calls.length = 0;
const v2 = await reading.lookup({ ...request, diagnosticsVersion: 2 });
assert.equal(v2.contractVersion, 2);
assert.equal(v2.providerId, "app.tsuzuki.mangaall");
assert.equal(v2.provenance, expectedMarker);
assert.equal(Object.hasOwn(v2, "hostProvenance"), false,
  "signed installation evidence must originate exclusively from the Host");
assert.deepEqual(v2.sourceStatuses.map(s => s.source), ["mangadex", "mangadot", "mangafire"]);
assert.equal(Object.hasOwn(v2, "items"), false, "V2 must never impersonate a V1 page");
assert.equal(v2.eligibleForReader, false);
assert.equal(v2.eligibleForCanonicalBinding, false);
assert.ok(!JSON.stringify(v2).includes("headers"));
assert.ok(!JSON.stringify(v2).includes("cookie"));
assert.ok(calls.every(origin => origins.has(origin)));
assert.deepEqual([...new Set(calls)].sort(), [...origins].sort(),
  "all three internal adapters must be contacted within this one MangaAll lookup");

console.log("MANGAALL_CODE9_STAGING|jsEntry=PARSED|v1=V1_PAGE|v2=THREE_SOURCE_READONLY|http=SYNTHETIC_ONLY|wire=" + expectedMarker);
