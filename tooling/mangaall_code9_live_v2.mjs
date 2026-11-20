// Opt-in *unsigned-code9* V2 network diagnostics, never a Host/Reader grant.
// One unified MangaAll lookup touches the three internal source adapters.
// No signing, raw responses, cookies, browser challenge bypass or image bytes.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createHttpBridge } from "./mangaall_live_probe_core.mjs";

export const SOURCE_ORIGINS = Object.freeze({
  mangadex: "https://api.mangadex.org",
  mangadot: "https://mangadot.net",
  mangafire: "https://mangafire.to",
});
const SOURCE_ORDER = Object.keys(SOURCE_ORIGINS);
const STATUS = new Set(["NOT_QUERIED", "SUCCESS_PAGE", "FAILED"]);
const FAILURE = new Set(["CHALLENGE_BLOCKED", "HTTP_ERROR", "INVALID_RESPONSE", "UNCLASSIFIED_ERROR"]);
const MAX_TITLES = 3;
const MAX_PAGES = 3;
const VERSION_MARKER = "V2_READONLY_OBSERVATION";

export function parseTitles(raw) {
  let values;
  try { values = JSON.parse(raw); } catch { throw Error("MangaAll V2 input must be a JSON array"); }
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_TITLES ||
      values.some(title => typeof title !== "string" || title.trim() !== title ||
        title.length < 2 || title.length > 100 || /[\x00-\x1f\x7f<>]|https?:\/\/|(?:cookie|bearer|authorization)\s*:/iu.test(title)) ||
      new Set(values.map(x => x.toLocaleLowerCase("en"))).size !== values.length) {
    throw Error("MangaAll V2 requires 1-3 distinct plain-language titles");
  }
  return values;
}

export function createStrictHttpService(fetchImpl) {
  const bridges = Object.fromEntries(SOURCE_ORDER.map(source => [source,
    createHttpBridge({
      origin: SOURCE_ORIGINS[source],
      fetchImpl,
      maxRequests: 12,
      maxResponseBytes: 2 * 1024 * 1024,
      timeoutMs: 12000,
    }),
  ]));
  return {
    http: {
      async request(method, url, headersJson, body) {
        let source;
        try {
          const uri = new URL(url);
          source = SOURCE_ORDER.find(key => SOURCE_ORIGINS[key] === uri.origin);
          if (uri.username || uri.password || uri.hash) source = null;
        } catch { source = null; }
        if (!source) throw Error("MangaAll V2 origin is not allowlisted");
        return bridges[source].request(method, url, headersJson, body);
      },
    },
    requests: () => Object.fromEntries(SOURCE_ORDER.map(source => [
      source, bridges[source].requestCount,
    ])),
  };
}
function checkedPage(result) {
  if (!result || result.contractVersion !== 2 ||
      result.providerId !== "app.tsuzuki.mangaall" ||
      result.provenance !== VERSION_MARKER ||
      result.eligibleForReader !== false ||
      result.eligibleForCanonicalBinding !== false ||
      Object.hasOwn(result, "items") || Object.hasOwn(result, "hostProvenance") ||
      !Array.isArray(result.sourceStatuses) || result.sourceStatuses.length !== 3 ||
      !Array.isArray(result.observedCandidates) ||
      Buffer.byteLength(JSON.stringify(result), "utf8") > 48 * 1024 ||
      result.sourceStatuses.some((record, index) =>
        record.source !== SOURCE_ORDER[index] ||
        !STATUS.has(record.status) ||
        (record.failure != null && (!FAILURE.has(record.failure.code) ||
          (record.failure.httpStatus != null &&
            (!Number.isInteger(record.failure.httpStatus) ||
             record.failure.httpStatus < 100 || record.failure.httpStatus > 599))))) {
    throw Error("MangaAll code9 V2 contract failed closed");
  }
  return result;
}

export async function auditOneTitle(reading, title) {
  const pages = [];
  const visited = new Set();
  let cursor = null;
  for (let index = 0; index < MAX_PAGES; index++) {
    let result;
    try {
      result = checkedPage(await reading.lookup({
        titles: [title],
        requestedLanguage: "en",
        diagnosticsVersion: 2,
        ...(cursor === null ? {} : { cursor }),
      }));
    } catch {
      return {
        title,
        outcome: "INCONCLUSIVE_PROVIDER_EXECUTION",
        requestedSources: SOURCE_ORDER,
        pages,
        network: "DIRECT_LIVE_RUNNER_UNTRUSTED_CODE9",
        editorialBinding: "NEVER",
        readerPixels: "NOT_TESTED",
      };
    }
    pages.push({
      page: index + 1,
      state: result.state,
      lookupComplete: result.lookupComplete,
      observedCandidateCount: result.observedCandidates.length,
      sourceStatuses: result.sourceStatuses.map(v => ({
        source: v.source,
        status: v.status,
        observedCandidates: v.observedCandidates,
        pageComplete: v.pageComplete,
        observationsTruncated: v.observationsTruncated,
        unsafeCandidate: v.unsafeCandidate,
        failure: v.failure == null ? null : {
          code: v.failure.code,
          httpStatus: v.failure.httpStatus,
          retryable: v.failure.retryable,
        },
      })),
    });
    if (!result.canContinue) break;
    const next = result.continuationCursor;
    if (typeof next !== "string" || next.length < 1 || next.length > 512 ||
        visited.has(next)) {
      return {
        title,
        outcome: "INCONCLUSIVE_CURSOR_INVALID",
        requestedSources: SOURCE_ORDER,
        pages,
        network: "DIRECT_LIVE_RUNNER_UNTRUSTED_CODE9",
        editorialBinding: "NEVER",
        readerPixels: "NOT_TESTED",
      };
    }
    visited.add(next);
    cursor = next;
  }
  const everySourceFirstPage = pages[0]?.sourceStatuses.every(s => s.status === "SUCCESS_PAGE");
  const firstComplete = pages.length === 1 && pages[0]?.lookupComplete === true && everySourceFirstPage;
  return {
    title,
    outcome: firstComplete ? "FIRST_PAGE_COMPLETE_UNCORROBORATED" : "INCONCLUSIVE_OR_PARTIAL",
    requestedSources: SOURCE_ORDER,
    pages,
    network: "DIRECT_LIVE_RUNNER_UNTRUSTED_CODE9",
    editorialBinding: "NEVER",
    readerPixels: "NOT_TESTED",
  };
}

export async function runLiveV2(titles, { fetchImpl = fetch, readOnlyModule = null } = {}) {
  const inputs = parseTitles(JSON.stringify(titles));
  const manifest = JSON.parse(fs.readFileSync("providers/mangaall/manifest.json", "utf8"));
  if (manifest.id !== "app.tsuzuki.mangaall" ||
      manifest.version?.code !== 9 || manifest.version?.name !== "0.5.4" ||
      manifest.publication !== "release" || manifest.permissions?.storage?.enabled !== false) {
    throw Error("Unsigned code9 V2 audit requires exact promoted source manifest");
  }
  const service = createStrictHttpService(fetchImpl);
  globalThis.tsuzuki = { http: service.http }; // Deliberately NO Browser Host Service
  const module = readOnlyModule ??
    await import(pathToFileURL(process.cwd() + "/providers/mangaall/main.js").href);
  const reading = module.default?.reading;
  if (!reading?.lookup || !reading?.chapters || !reading?.pages) {
    throw Error("Unified MangaAll Provider API missing");
  }
  const observations = [];
  for (const title of inputs) observations.push(await auditOneTitle(reading, title));
  return {
    auditType: "MANGAALL_CODE9_UNSIGNED_READ_ONLY_LIVE",
    trustedInstallation: false,
    signedCode9Verified: false,
    readerEnabled: false,
    catalogBindingAllowed: false,
    userDataWritten: false,
    titleCount: inputs.length,
    observations,
    requestsBySource: service.requests(),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== "--live" ||
      process.env.MANGAALL_CODE9_V2_LIVE_OPT_IN !== "I_ACCEPT_LIVE_READ_ONLY") {
    throw Error("Manual code9 V2 live audit requires explicit read-only opt-in");
  }
  const titles = parseTitles(process.env.MANGAALL_CODE9_V2_TITLES || "");
  console.log(JSON.stringify(await runLiveV2(titles), null, 2));
}
