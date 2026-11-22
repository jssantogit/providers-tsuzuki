// MangaAll opt-in LIVE read-only journey. Uses original source adapters; no Reader authorization.
// Source pages are public metadata, NOT verified canonical chapters or rendered image pixels.
// All limits apply per work; no challenge bypass, cookies, downloaded image bytes or source rebinding.
const SOURCES = new Set(["mangadex", "mangadot", "mangafire"]);
const DETAILS = new Set(["VERIFIED_WITH_ALIASES", "VERIFIED_NO_ALIASES"]);
const PROSE = new Set(["light_novel", "web_novel"]);

export function normalize(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
    : "";
}
export function errorCode(error) {
  if (["CHALLENGE_BLOCKED", "HTTP_ERROR", "INVALID_RESPONSE", "UNCLASSIFIED_ERROR"].includes(error?.lookupFailureCode)) {
    return error.lookupFailureCode;
  }
  const message = typeof error?.message === "string" ? error.message : "";
  if (/challenge required/i.test(message)) return "CHALLENGE_BLOCKED";
  const http = /HTTP ([1-5]\d\d)\b/.exec(message);
  if (http) return "HTTP_" + http[1];
  if (error?.name === "TimeoutError") return "TIMEOUT";
  const seen = new Set();
  for (let node = error, depth = 0; node && typeof node === "object" &&
      !seen.has(node) && depth < 5; node = node.cause, depth++) {
    seen.add(node);
    if (["ENOTFOUND", "EAI_AGAIN"].includes(node.code)) return "DNS";
    if (["ECONNRESET", "ECONNREFUSED", "ENETUNREACH"].includes(node.code)) return "CONNECTION";
    if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(node.code)) return "TIMEOUT";
    if (typeof node.code === "string" &&
      (node.code.startsWith("ERR_SSL_") || node.code.startsWith("ERR_TLS_"))) return "TLS";
  }
  return "UPSTREAM_OR_RUNTIME_ERROR";
}
export function granted(url, grants) {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password ||
        target.hash || target.port) return false;
    return grants.some((grant) => {
      if (typeof grant !== "string") return false;
      if (!grant.startsWith("https://*.")) return target.origin === grant;
      const suffix = grant.slice("https://*.".length);
      return target.hostname.endsWith("." + suffix) &&
        target.hostname.length > suffix.length + 1;
    });
  } catch { return false; }
}
function exact(candidate, titles) {
  return [candidate.title, ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])]
    .some((value) => titles.some((title) => normalize(value) === normalize(title)));
}
function validPage(page, itemLimit) {
  return page && Array.isArray(page.items) && page.items.length <= itemLimit &&
    (page.nextCursor == null || (typeof page.nextCursor === "string" &&
      page.nextCursor.length > 0 && page.nextCursor.length <= 512));
}
// Closed, length-bounded public fields in the opt-in CI result; never include
// upstream URL, authentication material or unbounded arbitrary metadata.
function safePublicText(input, limit) {
  if (typeof input !== "string") return null;
  const text = input.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!text || /https?:\/\/|[<>\x00-\x1F\x7F]/iu.test(text)) return null;
  return text.slice(0, limit);
}
function safePublicWorkId(input) {
  return typeof input === "string" &&
    /^(?:mangadex|mangadot|mangafire):[A-Za-z0-9._-]{1,128}$/.test(input)
    ? input : null;
}
function safePublicCode(input) {
  return typeof input === "string" && /^[A-Z_]{1,45}$/.test(input)
    ? input : null;
}
function safeNumber(input) {
  return Number.isSafeInteger(input) && input >= 0 && input <= 1_000_000_000
    ? input : null;
}
function sourceName(externalWorkId) {
  const prefix = typeof externalWorkId === "string" ? externalWorkId.split(":")[0] : "";
  return SOURCES.has(prefix) ? prefix : null;
}
function chapterValid(item, source) {
  return typeof item?.providerChapterId === "string" &&
    item.providerChapterId.startsWith(source + ":") &&
    Number.isFinite(item.rawNumber) && item.rawNumber >= 0 &&
    (item.language == null || item.language === "en");
}
// Read-only, bounded previews of HIDs actually returned by upstream.
// Comparing real rivals requires observing their separate source inventories,
// but it does NOT authorize Host binding, canonical publication or Reader use.
async function sourceChapterPreview(reading, candidate, pageLimit, allowUnverifiedMangadot = false) {
  const source = sourceName(candidate.externalWorkId);
  const result = {
    source, workId: safePublicWorkId(candidate.externalWorkId),
    authority: "SOURCE_METADATA_ONLY",
    chapterPages: 0, chapterCount: 0, firstNumber: null, lastNumber: null,
    chapterOnePresent: false, hasMore: true, outcome: "NOT_INSPECTED",
  };
  // Coverage UNKNOWN means the brief work-level preview could not find a
  // numbered chapter. It is NOT an empty inventory. A read-only, bounded V1
  // chapter query may independently observe numbered chapters, but only for a
  // real source-scoped HID with verified details and nonempty source authors.
  // Never grant a preferred edition, canonical binding or Reader from this.
  const authorsObserved = Array.isArray(candidate.authors) &&
    candidate.authors.some((author) => typeof author === "string" && normalize(author));
  const coveragePermitsReadOnlyPreview =
    candidate.coverageOutcome === "OBSERVED" || candidate.coverageOutcome === "UNKNOWN";
  // MangaDot search supplies only a title and its source-scoped numeric HID,
  // without authors or verified details. A separately opted-in CI diagnosis
  // may query at most two chapter metadata pages for that observed HID, but
  // these source rows are NOT identity evidence or edition authorization.
  const mangadotDiagnostic = allowUnverifiedMangadot && source === "mangadot" &&
    /^mangadot:[1-9][0-9]{0,15}$/.test(result.workId || "") &&
    !authorsObserved && !DETAILS.has(candidate.detailOutcome) &&
    candidate.coverageOutcome == null;
  const verifiedDiagnostic = DETAILS.has(candidate.detailOutcome) &&
    authorsObserved && coveragePermitsReadOnlyPreview;
  if (!result.workId || (!verifiedDiagnostic && !mangadotDiagnostic)) {
    result.outcome = "SOURCE_DETAIL_OR_COVERAGE_UNVERIFIED";
    return result;
  }
  if (mangadotDiagnostic) result.authority = "SOURCE_UNVERIFIED_HID_DIAGNOSTIC_ONLY";
  let cursor = null;
  const seenCursors = new Set();
  const seenIds = new Set();
  const numbers = [];
  for (let pageIndex = 0; pageIndex < pageLimit; pageIndex++) {
    let page;
    try {
      page = await reading.chapters({
        binding: {
          providerId: "app.tsuzuki.mangaall",
          facetId: "en",
          externalWorkId: candidate.externalWorkId,
        },
        cursor,
      });
    } catch (error) {
      result.errorCode = errorCode(error);
      result.outcome = "SOURCE_UPSTREAM_ERROR";
      break;
    }
    result.chapterPages++;
    if (!validPage(page, 16000) ||
        page.items.some((item) => !chapterValid(item, source)) ||
        page.items.some((item) => seenIds.has(item.providerChapterId))) {
      result.outcome = "SOURCE_INVALID_CONTRACT";
      break;
    }
    for (const item of page.items) {
      seenIds.add(item.providerChapterId);
      numbers.push(item.rawNumber);
    }
    if (page.nextCursor == null) {
      result.outcome = numbers.length ? "SOURCE_COMPLETE" : "SOURCE_COMPLETE_EMPTY";
      result.hasMore = false;
      break;
    }
    if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) {
      result.outcome = "SOURCE_INVALID_CONTRACT";
      break;
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
    result.outcome = "SOURCE_PARTIAL_PAGE_LIMIT";
  }
  result.chapterCount = numbers.length;
  result.firstNumber = numbers.length ? Math.min(...numbers) : null;
  result.lastNumber = numbers.length ? Math.max(...numbers) : null;
  result.chapterOnePresent = numbers.includes(1);
  return result;
}

function closedPageFailure(stage) {
  return typeof stage === "string" && /^[A-Z_]{1,60}$/.test(stage) ? stage : "UNCLASSIFIED";
}
const maxAttempts = 2;

/**
 * - knownWorkId (A54 verified): exercise exactly that source HID, never auto-bind an edition.
 * - other comic works: observe candidate chapters/pages ONLY with a single exact,
 *   detailed, author-bearing and coverage-attested HID from a complete lookup.
 * - prose: discovery only, even with a comic homonym.
 * - a page cursor, malformed result or rival HID prevents declaring completeness.
 */
export async function probeJourney(reading, spec, grants, options = {}) {
  const lookupPageLimit = options.lookupPageLimit ?? 3;
  const chapterPageLimit = options.chapterPageLimit ?? 4;
  // Official code9 routes diagnosticsVersion=2 to a *different*, read-only
  // V2 envelope without V1 items. Canonical/chapter/SQLite replay requires
  // the actual signed V1 reading.lookup contract, not a coerced V2 result.
  const lookupContract = options.lookupContract ?? 'legacy';
  if (lookupContract !== 'legacy' && lookupContract !== 'v1') {
    throw Error('Invalid MangaAll live lookup contract');
  }
  if (!Number.isInteger(lookupPageLimit) || lookupPageLimit < 1 || lookupPageLimit > 8 ||
      !Number.isInteger(chapterPageLimit) || chapterPageLimit < 1 || chapterPageLimit > 8) {
    throw Error("Invalid bounded MangaAll journey limits");
  }
  const result = {
    case: spec.id, format: spec.format, probe: spec.probe,
    evidence: "API_LIVE", authority: "SOURCE_METADATA_ONLY_NO_CANONICAL_OR_READER_PROOF",
    lookup: "UNKNOWN", chapters: "NOT_PROBED", pages: "NOT_PROBED",
    lookupPages: 0, chapterPages: 0, chapterCount: 0,
  };
  const titles = spec.names.filter((x) => normalize(x));
  const candidates = new Map();
  let lookupComplete = true;
  for (const title of titles.slice(0, 3)) {
    let cursor = null;
    const cursors = new Set();
    for (let pageIndex = 0; pageIndex < lookupPageLimit; pageIndex++) {
      let response;
      try {
        response = await reading.lookup({
          titles: [title], cursor, requestedLanguage: "en",
          // The production Host LookupRequestDto has diagnosticsVersion=1
          // and editorialEvidenceVersion=1 defaults, and its Json encoder
          // uses encodeDefaults=true. The signed-code9 V1 capture MUST send
          // those serialized wire fields, although the public Domain request
          // does not expose them. Version 2 is ONLY the read-only V2 envelope.
          ...(lookupContract === 'legacy'
            ? { diagnosticsVersion: 2, editorialEvidenceVersion: 1 }
            : { diagnosticsVersion: 1, editorialEvidenceVersion: 1 }),
          coverageEvidenceVersion: 1,
        });
      } catch (error) {
        result.lookupError = errorCode(error);
        lookupComplete = false;
        break;
      }
      result.lookupPages++;
      // MangaAll code8's bounded exhausted-retry response is an explicit
      // failed lookup, even though its strict Host-V1 envelope has an empty
      // items array and a null cursor. Never certify a complete empty source.
      if (typeof response?.lookupFailureCode === "string") {
        if (!validPage(response, 500) || response.items.length > 0) {
          result.lookup = "INVALID_CONTRACT";
        } else {
          result.lookupError = errorCode(response);
          lookupComplete = false;
        }
        break;
      }
      if (!validPage(response, 500)) {
        result.lookup = "INVALID_CONTRACT";
        break;
      }
      for (const row of response.items) {
        if (!row || typeof row.externalWorkId !== "string" ||
            !sourceName(row.externalWorkId)) {
          result.lookup = "INVALID_CONTRACT";
          break;
        }
        // One HID has one source-scoped identity. Reject contradicting titles
        // across paginated observations rather than overwriting a prior candidate.
        const previous = candidates.get(row.externalWorkId);
        if (previous && normalize(previous.title) !== normalize(row.title)) {
          result.lookup = "INVALID_CONTRACT";
          break;
        }
        candidates.set(row.externalWorkId, row);
      }
      if (result.lookup === "INVALID_CONTRACT") break;
      if (!response.nextCursor) break;
      if (cursors.has(response.nextCursor) || response.nextCursor === cursor) {
        result.lookup = "INVALID_CONTRACT";
        break;
      }
      cursors.add(response.nextCursor);
      cursor = response.nextCursor;
      if (pageIndex === lookupPageLimit - 1) lookupComplete = false;
    }
    if (result.lookup === "INVALID_CONTRACT") break;
  }
  if (options.includeCandidates === true) {
    // Bounded, source-attested public metadata only. No raw URLs, page bytes,
    // cookies, response bodies or upstream error text enters the CI artifact.
    // This reveals genuine rival HIDs rather than manufacturing test rivals.
    const observed = [...candidates.values()].sort((a, b) =>
      a.externalWorkId.localeCompare(b.externalWorkId));
    result.candidateCount = observed.length;
    result.candidateSummariesTruncated = observed.length > 24;
    result.candidateSummaries = observed.slice(0, 24).map((row) => ({
      source: sourceName(row.externalWorkId),
      workId: safePublicWorkId(row.externalWorkId),
      title: safePublicText(row.title, 160),
      aliases: (Array.isArray(row.aliases) ? row.aliases : [])
        .map((x) => safePublicText(x, 120)).filter(Boolean).slice(0, 5),
      authors: (Array.isArray(row.authors) ? row.authors : [])
        .map((x) => safePublicText(x, 120)).filter(Boolean).slice(0, 5),
      language: safePublicText(row.language, 20),
      detailOutcome: safePublicCode(row.detailOutcome),
      coverageOutcome: safePublicCode(row.coverageOutcome),
      coverageObservedCount: Number.isInteger(row.coverageObservedCount) &&
        row.coverageObservedCount >= 0 ? row.coverageObservedCount : null,
      coverageHasMore: typeof row.coverageHasMore === "boolean" ?
        row.coverageHasMore : null,
      coverageMinMilli: safeNumber(row.coverageMinMilli),
      coverageMaxMilli: safeNumber(row.coverageMaxMilli),
      exactMatch: exact(row, titles),
    }));
  }
  const matched = [...candidates.values()].filter((v) => exact(v, titles));
  const known = spec.work ? matched.find((v) => v.externalWorkId === spec.work) : null;
  result.lookupComplete = lookupComplete && result.lookup !== "INVALID_CONTRACT";
  result.sourcesSeen = [...new Set([...candidates.keys()].map(sourceName))].sort();
  result.matchingSources = [...new Set(matched.map((v) => sourceName(v.externalWorkId)))].sort();
  result.matchingWorkCount = matched.length;
  result.sameSourceRivals = result.matchingSources.some((source) =>
    matched.filter((v) => sourceName(v.externalWorkId) === source).length > 1);
  result.unresolvedCandidates = matched.length > 1;
  // An author disagreement between different source records is a diagnostic,
  // not independent proof of which canonical work/edition either record is.
  const authorSets = matched.map((row) =>
    (Array.isArray(row.authors) ? row.authors : [])
      .map((v) => normalize(v).split(/\s+/).filter(Boolean).sort().join(" "))
      .filter(Boolean).sort().join("|"),
  ).filter(Boolean);
  result.sourceAuthorDisagreement = new Set(authorSets).size > 1;
  result.publicationFormatVerified = false;
  if (result.lookup !== "INVALID_CONTRACT") {
    result.lookup = result.lookupError
      ? "UPSTREAM_ERROR" : matched.length
        ? (spec.work && known ? "EXACT_WORK" : "DISCOVERY_OBSERVED")
        : lookupComplete ? "NO_MATCH" : "PARTIAL_NO_MATCH";
  }
  if (options.includeCandidateCoverage === true && !PROSE.has(spec.format) &&
      result.lookup !== "INVALID_CONTRACT" &&
      (matched.length > 1 || !result.lookupComplete)) {
    const previewLimit = options.candidatePreviewLimit ?? 3;
    const previewPages = options.candidateChapterPageLimit ?? 2;
    if (!Number.isInteger(previewLimit) || previewLimit < 1 || previewLimit > 3 ||
        !Number.isInteger(previewPages) || previewPages < 1 || previewPages > 3) {
      throw Error("Invalid read-only candidate preview budget");
    }
    const ordered = matched.slice().sort((a, b) =>
      a.externalWorkId.localeCompare(b.externalWorkId));
    result.candidatePreviewsTruncated = ordered.length > previewLimit;
    result.candidateChapterPreviews = [];
    for (const candidate of ordered.slice(0, previewLimit)) {
      result.candidateChapterPreviews.push(await sourceChapterPreview(
        reading, candidate, previewPages,
        options.includeUnverifiedMangadotSourceDiagnostic === true,
      ));
    }
  }
  const chosen = spec.work ? known : matched.length === 1 && result.lookupComplete ? matched[0] : null;
  if (chosen) {
    result.authorsPresent = Array.isArray(chosen.authors) &&
      chosen.authors.some((author) => normalize(author));
    result.detailVerified = DETAILS.has(chosen.detailOutcome);
    result.coverage = typeof chosen.coverageOutcome === "string" &&
      ["OBSERVED", "EMPTY", "UNKNOWN", "INVALID_RESPONSE", "CHALLENGE_BLOCKED"].includes(chosen.coverageOutcome)
      ? chosen.coverageOutcome : "NOT_REPORTED";
    result.coverageCount = Number.isInteger(chosen.coverageObservedCount) &&
      chosen.coverageObservedCount >= 0 && chosen.coverageObservedCount <= 10000
      ? chosen.coverageObservedCount : null;
    result.coverageHasMore = typeof chosen.coverageHasMore === "boolean"
      ? chosen.coverageHasMore : null;
  }
  if (result.lookup === "INVALID_CONTRACT" || PROSE.has(spec.format) || !chosen ||
      !result.detailVerified || !result.authorsPresent || result.coverage !== "OBSERVED" ||
      !result.lookupComplete || (result.unresolvedCandidates && !spec.work)) {
    result.chapters = PROSE.has(spec.format) ? "FORMAT_BOUNDARY" :
      result.unresolvedCandidates ? "AMBIGUOUS_NOT_AUTHORIZED" : "NOT_TESTED";
    result.pages = "NOT_TESTED";
    return result;
  }
  // Even a candidate without a device-verified HID is probed read-only, never
  // persisted as an editorial binding, canonical chapter or Reader source.
  result.sourceSelection = spec.work ? "DEVICE_VERIFIED_HID" : "UNVERIFIED_UNIQUE_API_CANDIDATE";
  const source = sourceName(chosen.externalWorkId);
  const binding = {
    providerId: "app.tsuzuki.mangaall", facetId: "en", externalWorkId: chosen.externalWorkId,
  };
  const seenChapters = new Set();
  const seenCursors = new Set();
  const observations = [];
  let cursor = null;
  let finished = false;
  for (let pageIndex = 0; pageIndex < chapterPageLimit; pageIndex++) {
    let page;
    try {
      page = await reading.chapters({ binding, cursor });
    } catch (error) {
      result.chaptersError = errorCode(error);
      result.chapters = observations.length ? "PARTIAL_UPSTREAM_ERROR" : "UPSTREAM_ERROR";
      break;
    }
    result.chapterPages++;
    if (!validPage(page, 16000) || page.items.some((item) => !chapterValid(item, source))) {
      result.chapters = "INVALID_CONTRACT";
      break;
    }
    for (const item of page.items) {
      if (seenChapters.has(item.providerChapterId)) {
        result.chapters = "INVALID_CONTRACT";
        break;
      }
      seenChapters.add(item.providerChapterId);
      observations.push(item);
    }
    if (result.chapters === "INVALID_CONTRACT") break;
    if (!page.nextCursor) {
      finished = true;
      break;
    }
    if (seenCursors.has(page.nextCursor) || page.nextCursor === cursor) {
      result.chapters = "INVALID_CONTRACT";
      break;
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  result.chapterCount = observations.length;
  result.chapterHasMore = !finished;
  result.chapterFirstNumber = observations[0]?.rawNumber ?? null;
  result.chapterLastNumber = observations.at(-1)?.rawNumber ?? null;
  result.chapterOnePresent = observations.some((row) => row.rawNumber === 1);
  // Detect suspicious numeric gaps without assuming every edition's numbering is consecutive.
  const integerNumbers = [...new Set(observations.map((x) => x.rawNumber)
    .filter((x) => Number.isInteger(x) && x > 0))].sort((a, b) => a - b);
  result.numberingGapObserved = integerNumbers.some((x, i) =>
    i > 0 && x > integerNumbers[i - 1] + 1);
  if (result.chapters === "NOT_PROBED") {
    result.chapters = finished ? (observations.length ? "COMPLETE" : "COMPLETE_EMPTY") :
      "PARTIAL_PAGE_LIMIT";
  }
  // Upstream page URL metadata is probed even for partial inventories, but
  // never upgrades a truncated chapter set to complete.
  const chapterOne = observations.find((item) => item.rawNumber === 1);
  const first = chapterOne ?? observations[0];
  if (!first || result.chapters === "INVALID_CONTRACT") {
    result.pages = first ? "NOT_TESTED" : "NO_CHAPTER_FOR_READER";
    return result;
  }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const target = attempt === 0 ? first : observations.at(-1);
    if (attempt > 0 && target.providerChapterId === first.providerChapterId) break;
    let delivery;
    try {
      delivery = await reading.pages({
        binding, providerChapterId: target.providerChapterId, diagnosticsVersion: 2,
      });
    } catch (error) {
      result.pagesError = errorCode(error);
      result.pages = "UPSTREAM_ERROR";
      continue;
    }
    if (delivery?.type === "page_failure") {
      result.pages = "TYPED_FAILURE";
      result.pageFailureStage = closedPageFailure(delivery.pageFailureStage);
      continue;
    }
    if (delivery?.type !== "page_list" || !Array.isArray(delivery.pages) ||
        !delivery.pages.length || delivery.pages.length > 5000) {
      result.pages = "INVALID_CONTRACT";
      break;
    }
    result.pageCount = delivery.pages.length;
    result.pageOriginsAllowed = delivery.pages.every((item) => granted(item?.url, grants));
    result.pages = result.pageOriginsAllowed ? "METADATA_OBSERVED" : "INVALID_CONTRACT";
    break;
  }
  return result;
}
export function journeyVerdict(result) {
  if (result.candidateChapterPreviews?.some((item) =>
    item.outcome === "SOURCE_INVALID_CONTRACT")) return "FAIL_CONTRACT";
  if (result.lookup === "INVALID_CONTRACT" || result.chapters === "INVALID_CONTRACT" ||
      result.pages === "INVALID_CONTRACT" || result.pageOriginsAllowed === false) return "FAIL_CONTRACT";
  // Incomplete source discovery must not become a complete editorial decision.
  // Preserve the candidate conflict signal without claiming all rivals were seen.
  if (result.lookup === "UPSTREAM_ERROR" || result.lookup === "PARTIAL_NO_MATCH" ||
      result.lookup === "NO_MATCH" || !result.lookupComplete) {
    return result.unresolvedCandidates ? "PARTIAL_CANDIDATE_CONFLICT" : "INCONCLUSIVE";
  }
  if (result.unresolvedCandidates) return "AMBIGUOUS_EDITION";
  if (result.chapters.startsWith("PARTIAL")) return "PARTIAL_CHAPTER_INVENTORY";
  if (result.chapters === "COMPLETE_EMPTY") return "EMPTY_SOURCE_INVENTORY";
  if (result.chapters === "NOT_TESTED" || result.chapters === "AMBIGUOUS_NOT_AUTHORIZED" ||
      result.chapters === "FORMAT_BOUNDARY") {
    return result.lookup === "DISCOVERY_OBSERVED" ? "OBSERVED_API_DISCOVERY" : "INCONCLUSIVE";
  }
  if (result.chapters === "COMPLETE" && result.pages === "METADATA_OBSERVED" &&
      result.sourceSelection === "DEVICE_VERIFIED_HID") return "PASS_API";
  if (result.chapters === "COMPLETE" && result.pages === "METADATA_OBSERVED") {
    return "SOURCE_JOURNEY_NOT_CANONICAL";
  }
  return "INCONCLUSIVE";
}
