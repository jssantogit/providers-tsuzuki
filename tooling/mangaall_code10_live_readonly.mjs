// Real (not fixture) MangaALL code10 three-title source diagnostic.
// Executes ONE unified provider with its THREE internal sources. No canonical
// binding, image-byte download, Browser challenge bypass, signed-installation
// emulation, Host Kotlin or SQLite/Reader validation. Network read-only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHttpBridge } from "./mangaall_live_probe_core.mjs";
import { auditOneTitle } from "./mangaall_code9_live_v2.mjs";

const TITLES = Object.freeze(["Naruto", "Death Note", "Bleach"]);
const SOURCES = Object.freeze({
  mangadex: "https://api.mangadex.org",
  mangadot: "https://mangadot.net",
  mangafire: "https://mangafire.to",
});
const EXPECTED_SHA = "776d0e8bd64897c30283cad29f1aa331c86dac638deac1f106f042768167b94d";
const MANIFEST = "providers/mangaall/manifest.json";

export function sourceForId(id) {
  if (typeof id !== "string") return null;
  return Object.keys(SOURCES).find(s => id.startsWith(s + ":")) ?? null;
}
export function validateSourceIdentity() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const approved = JSON.parse(fs.readFileSync(
    "review/mangaall-code10/approved-artifact.json", "utf8"));
  assert.equal(manifest.id, "app.tsuzuki.mangaall");
  assert.deepEqual(manifest.version, {name: "0.5.5", code: 10});
  assert.equal(manifest.publication, "release");
  assert.equal(approved.reviewStatus, "approved");
  assert.equal(approved.artifactSha256, EXPECTED_SHA);
  assert.equal(approved.priorSequence, 35);
  assert.equal(approved.priorCode9Sha256,
    "d9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622");
  const signed = JSON.parse(fs.readFileSync("dist/index.payload.json", "utf8"));
  const entry = signed.providers.find(x => x.providerId === manifest.id);
  assert.equal(entry?.versionCode, 9, "this diagnostic does not certify an installed signed code10");
  assert.equal(signed.sequence, 35, "only source diagnostics before signed release");
  assert.equal(entry.sha256, approved.priorCode9Sha256);
  for (const origin of Object.values(SOURCES)) {
    assert.ok(manifest.permissions.network.origins.includes(origin));
  }
  assert.equal(manifest.permissions.storage.enabled, false);
  return {sha: approved.artifactSha256, version: manifest.version};
}

function bridge() {
  const bridges = Object.fromEntries(Object.entries(SOURCES).map(([name, origin]) =>
    [name, createHttpBridge({origin, fetchImpl: fetch, maxRequests: 48,
      maxResponseBytes: 512 * 1024, timeoutMs: 12000})]));
  const http = {request(method, url, headersJson, body) {
    let uri;
    try { uri = new URL(url); } catch { throw Error("MangaALL origin rejected"); }
    const source = Object.keys(SOURCES).find(name => uri.origin === SOURCES[name]);
    if (!source || uri.username || uri.password || uri.hash) {
      throw Error("MangaALL origin rejected");
    }
    return bridges[source].request(method, url, headersJson, body);
  }};
  return {http, counts: () => Object.fromEntries(
    Object.keys(SOURCES).map(name => [name, bridges[name].requestCount]))};
}
function sourceCounts(items) {
  const counts = Object.fromEntries(Object.keys(SOURCES).map(x => [x, 0]));
  for (const item of items) {
    const key = sourceForId(item?.externalWorkId);
    if (key) counts[key]++;
  }
  return counts;
}
function errorClass(error) {
  const value = String(error?.message || "");
  if (/403|challenge/i.test(value)) return "SOURCE_CHALLENGE_OR_HTTP403";
  if (/429/.test(value)) return "SOURCE_RATE_LIMIT";
  if (/limit/.test(value)) return "BOUNDED_REQUEST_LIMIT";
  if (/timeout/i.test(value) || error?.name === "TimeoutError") return "UPSTREAM_TIMEOUT";
  if (/invalid|malformed/i.test(value)) return "INVALID_SOURCE_RESPONSE";
  return "SOURCE_OR_PROVIDER_FAILURE";
}
async function auditV1(reading, title) {
  const pages = [], used = new Set();
  let cursor = null;
  for (let page = 1; page <= 8; page++) {
    let result;
    try {
      result = await reading.lookup({
        titles: [title], requestedLanguage: "en",
        ...(cursor ? {cursor} : {}),
      });
    } catch (error) {
      return {state: "INCONCLUSIVE_V1_FAILURE", errorClass: errorClass(error),
        pages, sourceDiscovery: "NOT_CANONICALLY_VERIFIED"};
    }
    if (!result || !Array.isArray(result.items) ||
        result.items.length > 96 ||
        Buffer.byteLength(JSON.stringify(result), "utf8") > 48 * 1024 ||
        !result.items.every(item => item && typeof item.externalWorkId === "string")) {
      return {state: "MALFORMED_V1_RESPONSE", pages};
    }
    if (result.lookupFailureCode) {
      const code = String(result.lookupFailureCode);
      return {state: "TERMINAL_SOURCE_FAILURE_CLOSED", failureCode: code,
        failureHttpStatus: result.lookupHttpStatus ?? null,
        pages, canonicalEditionVerified: false, readerTested: false};
    }
    const counts = sourceCounts(result.items);
    const sameWork = result.items.filter(item => typeof item.title === "string" &&
      (item.title.toLowerCase() === title.toLowerCase() ||
        (Array.isArray(item.aliases) &&
          item.aliases.some(alias => typeof alias === "string" &&
            alias.toLowerCase() === title.toLowerCase()))));
    let continuation = null;
    if (typeof result.nextCursor === "string") {
      try {
        const parsed = JSON.parse(result.nextCursor);
        continuation = {
          kind: parsed.v === 2 ? "DEFERRED_FAILURE" : "SOURCE_PAGINATION",
          sourceKeys: Object.keys(parsed.remaining || {}).sort(),
          hasFailure: Boolean(parsed.failure),
        };
      } catch {
        continuation = {kind: "INVALID", sourceKeys: [], hasFailure: false};
      }
    }
    pages.push({page, sourceCandidateCounts: counts,
      exactTitleCandidateCount: sameWork.length,
      nextCursorPresent: typeof result.nextCursor === "string",
      continuation});
    if (!result.nextCursor) {
      return {state: "LOOKUP_EXHAUSTED_UNVERIFIED",
        pages, canonicalEditionVerified: false, readerTested: false};
    }
    if (typeof result.nextCursor !== "string" ||
        result.nextCursor.length > 2048 || used.has(result.nextCursor)) {
      return {state: "INVALID_OR_REPEATED_CURSOR", pages};
    }
    used.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  return {state: "BOUNDED_AFTER_EIGHT_PAGES", pages,
    canonicalEditionVerified: false, readerTested: false};
}

export async function runRealThreeTitleDiagnostic() {
  const approved = validateSourceIdentity();
  const runtime = bridge();
  globalThis.tsuzuki = {http: runtime.http}; // Browser intentionally ABSENT.
  const module = await import(pathToFileURL(path.resolve("providers/mangaall/main.js")).href);
  const reading = module.default?.reading;
  assert.equal(typeof reading?.lookup, "function");
  assert.equal(typeof reading?.chapters, "function");
  assert.equal(typeof reading?.pages, "function");
  const titleResults = [];
  for (const title of TITLES) {
    const v2 = await auditOneTitle(reading, title);
    titleResults.push({
      title, unifiedV2: {
        ...v2, network: "REAL_DIRECT_SOURCE_HTTP_CODE10_NOT_HOST_RUNTIME",
      },
      unifiedV1: await auditV1(reading, title),
    });
  }
  return {kind: "MANGAALL_CODE10_REAL_THREE_SOURCE_THREE_TITLE_UNVERIFIED",
    liveSourceHttp: true, actualSourcesCombined: Object.keys(SOURCES),
    approvedSourceArtifactSha256: approved.sha, signedCode10Installed: false,
    hostKotlinTested: false, canonicalChaptersVerified: false,
    sqliteTested: false, readerPixelsTested: false,
    titles: titleResults, httpRequests: runtime.counts()};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] !== "--output" ||
      typeof process.argv[3] !== "string" ||
      !/^[A-Za-z0-9_.-]+\.json$/.test(path.basename(process.argv[3])) ||
      process.env.MANGAALL_CODE10_LIVE_DIAGNOSTIC_OPT_IN !== "THREE_WORKS_READ_ONLY") {
    throw Error("Code10 live source audit requires exact read-only three-title opt-in");
  }
  const report = await runRealThreeTitleDiagnostic();
  fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
