/*
 * UNSIGNED NEXT-CONTRACT CANDIDATE — NEVER THE PUBLISHED 0.5.3/code8.
 *
 * ONE original MangaAll router lookup (three adapters in parallel) with
 * read-only, source-scoped observations. Adapters are not called twice;
 * V1 bytes and behavior stay unchanged. This draft is intentionally outside
 * providers/mangaall/ and cannot enter the published TSZ or trust index.
 *
 * V2 observations are NOT V1 ProviderPage items, complete catalog snapshots,
 * approved editions, chapter grants, or Reader permission.
 */
import { createMangaAllReading, lookupTitleMatches } from "../providers/mangaall/modules/router.js";

export const SOURCE_ORDER = Object.freeze(["mangadex", "mangadot", "mangafire"]);
const SOURCE_SET = new Set(SOURCE_ORDER);
const MAX_OBSERVED_PER_SOURCE = 32;
const MAX_SAFE_TEXT = 160;
const WORK_ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const FAILURE_CODES = new Set(["CHALLENGE_BLOCKED", "HTTP_ERROR", "INVALID_RESPONSE", "UNCLASSIFIED_ERROR"]);

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
function safeText(raw) {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > MAX_SAFE_TEXT ||
      /[\x00-\x1f\x7f<>]|https?:\/\/|(?:cookie|authorization|bearer)\s*:/iu.test(raw)) return null;
  return raw.normalize("NFC");
}
function safeLabels(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const labels = value.map(safeText);
  return labels.every(v => v !== null) ? labels : null;
}
function classifiedFailure(error) {
  const code = FAILURE_CODES.has(error?.lookupFailureCode) ? error.lookupFailureCode : null;
  if (code) return {
    code, httpStatus: safeHttpStatus(error.lookupHttpStatus), retryable: code === "CHALLENGE_BLOCKED" ||
      (code === "HTTP_ERROR" && error.lookupHttpStatus >= 500),
  };
  if (error?.challengeRequired === true) return {
    code: "CHALLENGE_BLOCKED", httpStatus: safeHttpStatus(error.httpStatus), retryable: true,
  };
  const message = error instanceof Error ? error.message : "";
  const match = /^(?:MangaAll HTTP |MangaFire API request failed with HTTP )([1-5][0-9]{2})$/.exec(message);
  const status = safeHttpStatus(error?.httpStatus) ?? (match ? Number(match[1]) : null);
  if (status !== null) return {
    code: status === 403 ? "CHALLENGE_BLOCKED" : "HTTP_ERROR", httpStatus: status,
    retryable: status === 403 || status >= 500,
  };
  if (/^MangaAll invalid (?:HTTP response|HTTP status|JSON|API response|response size|source lookup response|source candidate)$/.test(message)) {
    return { code: "INVALID_RESPONSE", httpStatus: null, retryable: false };
  }
  return { code: "UNCLASSIFIED_ERROR", httpStatus: null, retryable: false };
}
function safeCandidate(source, raw, titles) {
  if (!raw || typeof raw !== "object" || !lookupTitleMatches(titles, raw)) return null;
  let id = raw.externalWorkId;
  if (typeof id !== "string") return null;
  if (source === "mangafire") {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
    id = "mangafire:" + id;
  } else if (!id.startsWith(source + ":") || !WORK_ID.test(id)) return null;
  if (id.length > 160) return null;
  const title = safeText(raw.title);
  const aliases = safeLabels(raw.aliases);
  const authors = safeLabels(raw.authors);
  if (title == null || aliases == null || authors == null) return null;
  return { source, externalWorkId: id, title, aliases, authors,
    editorialIdentityVerified: false, bindingEligible: false };
}

/**
 * Prototype V2. For V1 calls, return the untouched signed router's response.
 * For V2, emit a *different* envelope with no V1 "items" property.
 * Host must explicitly validate V2 before consuming it; this is not deployed.
 */
export function createMangaAllLookupV2Candidate(adapters) {
  if (!adapters || typeof adapters !== "object") throw Error("MangaAll adapters required");
  let active = null;
  const wrapped = Object.fromEntries(SOURCE_ORDER.map(source => {
    const original = adapters[source];
    return [source, {
      ...original,
      async lookup(request) {
        if (active === null) return original.lookup(request);
        const observed = active[source];
        observed.attempts++;
        try {
          const page = await original.lookup(request);
          if (page?.lookupFailureCode) {
            observed.status = "FAILED";
            observed.failure = classifiedFailure({
              lookupFailureCode: page.lookupFailureCode,
              lookupHttpStatus: page.lookupHttpStatus,
            });
            return page; // no mutation of original adapter response
          }
          if (!page || !Array.isArray(page.items) || page.items.length > 200) {
            observed.status = "FAILED";
            observed.failure = { code: "INVALID_RESPONSE", httpStatus: null, retryable: false };
            return page;
          }
          observed.status = "SUCCESS_PAGE";
          observed.pageComplete = page.nextCursor == null;
          for (const item of page.items) {
            if (!lookupTitleMatches(active.titles, item)) continue;
            const safe = safeCandidate(source, item, active.titles);
            if (!safe) {
              observed.unsafeCandidate = true;
              continue;
            }
            if (observed.candidates.some(v => v.externalWorkId === safe.externalWorkId)) continue;
            if (observed.candidates.length >= MAX_OBSERVED_PER_SOURCE) {
              observed.truncated = true;
              continue;
            }
            observed.candidates.push(safe);
          }
          return page;
        } catch (error) {
          observed.status = "FAILED";
          observed.failure = classifiedFailure(error);
          throw error; // original router handles the same error
        }
      },
    }];
  }));
  const router = createMangaAllReading(wrapped);

  return Object.freeze({
    // Source-scoped chapters and pages retain the original router's V1
    // authorization/identity checks. V2 diagnostics never auto-bind them.
    chapters: (input) => router.chapters(input),
    pages: (input) => router.pages(input),
    async lookup(input) {
      if (input?.diagnosticsVersion !== 2) return router.lookup(input);
      if (active !== null) throw Error("MangaAll candidate audit reentry not permitted");
      const perSource = Object.fromEntries(SOURCE_ORDER.map(source => [source, {
        source, attempts: 0, status: "NOT_QUERIED", pageComplete: null,
        failure: null, candidates: [], truncated: false, unsafeCandidate: false,
      }]));
      active = { ...perSource, titles: input.titles };
      let legacy;
      try {
        legacy = await router.lookup(input);
      } finally {
        active = null;
      }
      const sourceStatuses = SOURCE_ORDER.map(source => {
        const found = perSource[source];
        return {
          source, attempts: found.attempts, status: found.status,
          pageComplete: found.pageComplete,
          observedCandidates: found.candidates.length,
          observationsTruncated: found.truncated,
          unsafeCandidate: found.unsafeCandidate,
          failure: found.failure,
        };
      });
      const partial = sourceStatuses.some(x => x.status === "FAILED" ||
        x.unsafeCandidate || x.observationsTruncated);
      const globalFailure = legacy?.lookupFailureCode !== undefined;
      const allQueried = sourceStatuses.every(x => x.status === "SUCCESS_PAGE");
      const allCompleted = allQueried && sourceStatuses.every(x => x.pageComplete);
      const firstPage = input.cursor == null;
      const complete = !partial && !globalFailure && firstPage && allCompleted &&
        legacy?.nextCursor == null;
      const observedCandidates = SOURCE_ORDER.flatMap(source => perSource[source].candidates);
      // Do not provide a V1 ProviderPage or any 'authorized' work ID.
      // Partial source evidence cannot become chapters, preferred sources,
      // canonical snapshots or Reader input.
      return {
        contractVersion: 2,
        providerId: "app.tsuzuki.mangaall",
        state: complete ? "COMPLETE_SINGLE_PAGE" :
          observedCandidates.length ? "PARTIAL_EVIDENCE" : "INCONCLUSIVE",
        lookupComplete: complete,
        canContinue: !globalFailure && typeof legacy?.nextCursor === "string",
        continuationCursor: globalFailure ? null : legacy?.nextCursor ?? null,
        sourceStatuses, observedCandidates,
        eligibleForCanonicalBinding: false,
        eligibleForReader: false,
        provenance: "UNSIGNED_CANDIDATE_NOT_LIVE",
      };
    },
  });
}
