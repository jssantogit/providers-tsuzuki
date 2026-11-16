// Loss-minimized, bounded recording of REAL normalized MangaAll SCRIPT output.
// The caller must run the actual signed Provider JS against permitted HTTP.
// This layer observes calls; it must never alter source results, retry upstream,
// manufacture rival HIDs/chapters, or grant Host canonical/Reader authority.
import { createHash } from 'node:crypto';

const ID = /^(?:mangafire|mangadex|mangadot):[A-Za-z0-9._-]{1,128}$/u;
const CHAPTER_ID = /^(?:mangafire|mangadex|mangadot):[A-Za-z0-9._:-]{1,200}$/u;
const PUBLIC_STATUS = /^(?:VERIFIED_WITH_ALIASES|VERIFIED_NO_ALIASES|BUDGET_EXHAUSTED|NOT_NEEDED|DETAIL_FAILED|IDENTITY_MISMATCH|INVALID_RESPONSE|CHALLENGE_BLOCKED|OBSERVED|EMPTY|UNKNOWN|HTTP_ERROR|UNCLASSIFIED_ERROR|SOURCE_DETAIL_UNVERIFIED)$/u;
const SIMPLE_LANGUAGE = /^(?:en|pt-br|ja|zh|ko)$/u;
const CURSOR_LIMIT = 8192;
const SAFE_BYTES = 2_500_000;
const MAX_RECORDS = 128;
const MAX_CHAPTER_ITEMS = 4000;
const MAX_LOOKUP_ITEMS = 300;
const PUBLIC_TITLE_ORIGINS = new Set([
  'https://mangafire.to', 'https://mangadex.org', 'https://mangadot.net',
]);
const WORK_FIELDS = new Set([
  'externalWorkId', 'title', 'aliases', 'authors', 'url', 'language',
  'detailOutcome', 'detailHttpStatus', 'chapterCount', 'coverageOutcome',
  'coverageObservedCount', 'coverageMinMilli', 'coverageMaxMilli', 'coverageHasMore',
]);
const CHAPTER_FIELDS = new Set([
  'providerChapterId', 'rawLabel', 'rawNumber', 'volume', 'title', 'language',
  'scanlator', 'group', 'releaseDate', 'publishedAt',
]);

function publicText(value, length = 256) {
  if (typeof value !== 'string' || value.length > length) return null;
  const text = value.normalize('NFKC');
  if (!text.trim() || /[\x00-\x1f\x7f<>]/u.test(text) ||
      /https?:\/\/|(?:cookie|bearer|authorization)\s*:/iu.test(text)) return null;
  return text;
}
function identity(value, re) {
  return typeof value === 'string' && re.test(value) ? value : null;
}
function number(value, max = 1_000_000_000) {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= 0 && value <= max ? value : null;
}
function cursor(value, invalid) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.length || value.length > CURSOR_LIMIT ||
      /https?:\/\/|cookie|bearer|authorization|[\x00-\x1f\x7f<>]/iu.test(value)) {
    invalid();
    return null;
  }
  return value;
}
function safePublicUrl(raw, invalid) {
  if (raw == null) return undefined;
  if (typeof raw !== 'string' || raw.length > 400) { invalid(); return undefined; }
  try {
    const value = new URL(raw);
    if (!PUBLIC_TITLE_ORIGINS.has(value.origin) || value.username || value.password ||
        value.search || value.hash || value.port || value.protocol !== 'https:' ||
        !/^\/(?:title|manga)\/[A-Za-z0-9_./-]{1,200}\/?$/u.test(value.pathname)) {
      invalid();
      return undefined;
    }
    return raw;
  } catch { invalid(); return undefined; }
}
function safeFields(item, allowed, invalid) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    invalid(); return null;
  }
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) invalid();
  }
  return item;
}
function safeStringList(value, invalid, max = 32) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) { invalid(); return []; }
  return value.map(x => {
    const t = publicText(x, 160);
    if (t == null) invalid();
    return t;
  }).filter(x => x != null);
}
function work(item, invalid) {
  if (!safeFields(item, WORK_FIELDS, invalid)) return null;
  const externalWorkId = identity(item.externalWorkId, ID);
  const title = publicText(item.title, 256);
  if (!externalWorkId || title == null) { invalid(); return null; }
  const result = { externalWorkId, title };
  for (const key of ['aliases', 'authors']) {
    if (key in item) result[key] = safeStringList(item[key], invalid);
  }
  if (item.url != null) {
    const url = safePublicUrl(item.url, invalid);
    if (url !== undefined) result.url = url;
  }
  if (item.language != null) {
    if (!SIMPLE_LANGUAGE.test(item.language)) invalid();
    else result.language = item.language;
  }
  for (const key of ['detailOutcome', 'coverageOutcome']) {
    if (item[key] != null) {
      if (!PUBLIC_STATUS.test(item[key])) invalid();
      else result[key] = item[key];
    }
  }
  for (const key of ['detailHttpStatus', 'chapterCount', 'coverageObservedCount',
    'coverageMinMilli', 'coverageMaxMilli']) {
    if (item[key] != null) {
      const v = number(item[key]);
      if (v == null) invalid(); else result[key] = v;
    }
  }
  if (item.coverageHasMore != null) {
    if (typeof item.coverageHasMore !== 'boolean') invalid();
    else result.coverageHasMore = item.coverageHasMore;
  }
  return result;
}
function chapter(item, invalid) {
  if (!safeFields(item, CHAPTER_FIELDS, invalid)) return null;
  const providerChapterId = identity(item.providerChapterId, CHAPTER_ID);
  const rawLabel = publicText(item.rawLabel, 240);
  if (!providerChapterId || rawLabel == null) { invalid(); return null; }
  const result = { providerChapterId, rawLabel };
  if (item.rawNumber != null) {
    const v = number(item.rawNumber);
    if (v == null) invalid(); else result.rawNumber = v;
  }
  if (item.volume != null) {
    const v = number(item.volume, 10_000);
    if (v == null || !Number.isInteger(v)) invalid(); else result.volume = v;
  }
  for (const key of ['title', 'scanlator', 'group']) {
    if (item[key] != null) {
      const v = publicText(item[key], 240);
      if (v == null) invalid(); else result[key] = v;
    }
  }
  if (item.language != null) {
    if (!SIMPLE_LANGUAGE.test(item.language)) invalid();
    else result.language = item.language;
  }
  for (const key of ['releaseDate', 'publishedAt']) {
    if (item[key] != null) {
      const v = typeof item[key] === 'number'
        ? number(item[key], 1_000_000_000_000_000)
        : publicText(item[key], 80);
      if (v == null) invalid(); else result[key] = v;
    }
  }
  return result;
}
function safeBinding(binding, invalid) {
  if (!binding || typeof binding !== 'object' ||
      binding.providerId !== 'app.tsuzuki.mangaall' ||
      !identity(binding.externalWorkId, ID) ||
      !SIMPLE_LANGUAGE.test(binding.facetId)) {
    invalid();
    return { providerId: 'app.tsuzuki.mangaall', facetId: null, externalWorkId: null };
  }
  return { providerId: binding.providerId, facetId: binding.facetId,
    externalWorkId: binding.externalWorkId };
}
function requestFor(operation, input, invalid) {
  if (operation === 'lookup') {
    const titles = safeStringList(input?.titles, invalid, 12);
    const language = input?.requestedLanguage == null ? null : input.requestedLanguage;
    if (language != null && !SIMPLE_LANGUAGE.test(language)) invalid();
    const result = { titles, requestedLanguage: language, cursor: cursor(input?.cursor, invalid) };
    for (const key of ['diagnosticsVersion', 'editorialEvidenceVersion', 'coverageEvidenceVersion']) {
      if (input?.[key] != null) {
        const v = number(input[key], 100);
        if (v == null || !Number.isInteger(v)) invalid(); else result[key] = v;
      }
    }
    return result;
  }
  const binding = safeBinding(input?.binding, invalid);
  if (operation === 'chapters') return { binding, cursor: cursor(input?.cursor, invalid) };
  const providerChapterId = identity(input?.providerChapterId, CHAPTER_ID);
  if (!providerChapterId) invalid();
  return { binding, providerChapterId };
}
function responseFor(operation, value, invalid) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(); return { items: [], nextCursor: null };
  }
  if (operation === 'pages') {
    // CDN image URLs and custom headers are intentionally *never* exported.
    // This record cannot be replayed as a Reader page response.
    const pageCount = Array.isArray(value.pages) ? value.pages.length : null;
    if (pageCount == null || pageCount > 400) invalid();
    return { type: value.type === 'page_list' ? 'page_list' : 'NON_PAGE_LIST',
      pageCount: pageCount == null ? null : pageCount };
  }
  const limit = operation === 'lookup' ? MAX_LOOKUP_ITEMS : MAX_CHAPTER_ITEMS;
  const items = Array.isArray(value.items) && value.items.length <= limit ? value.items : null;
  if (!items) invalid();
  const result = {
    items: (items || []).map(item => operation === 'lookup'
      ? work(item, invalid) : chapter(item, invalid)).filter(Boolean),
    nextCursor: cursor(value.nextCursor, invalid),
  };
  if (operation === 'lookup' && value.lookupFailureCode != null) {
    if (!PUBLIC_STATUS.test(value.lookupFailureCode) ||
        result.items.length || value.nextCursor != null) invalid();
    else result.lookupFailureCode = value.lookupFailureCode;
    if (value.lookupHttpStatus != null) {
      const status = number(value.lookupHttpStatus, 599);
      if (status == null || status < 100 || !Number.isInteger(status)) invalid();
      else result.lookupHttpStatus = status;
    }
  }
  return result;
}
function safeError(error) {
  const code = typeof error?.lookupFailureCode === 'string' &&
      PUBLIC_STATUS.test(error.lookupFailureCode)
    ? error.lookupFailureCode
    : 'UPSTREAM_OR_RUNTIME_ERROR';
  return { code };
}

/**
 * Wraps the *real* MangaAll JS reading interface. Changes neither requests
 * nor returned results; no "auto-select" logic or synthetic data exists here.
 * The returned record stream only replays lookup/chapters safely. CDN pages
 * remain origin-free metadata, never a Reader result.
 */
export function createRealEnvelopeCapture(reading, {
  caseId, observedAt, providerCode, packageSha256,
  maxRecords = MAX_RECORDS, maxBytes = SAFE_BYTES,
} = {}) {
  if (!reading || ['lookup', 'chapters', 'pages'].some(k => typeof reading[k] !== 'function') ||
      !/^[A-Za-z0-9_-]{1,100}$/u.test(caseId) ||
      !Number.isInteger(providerCode) || providerCode < 8 ||
      !/^[a-f0-9]{64}$/u.test(packageSha256) ||
      typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt)) ||
      !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 300 ||
      !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 8_000_000) {
    throw new Error('MangaAll real capture origin or bounded config invalid');
  }
  const records = [];
  let invalidFields = false;
  let budgetExceeded = false;
  let byteCount = 0;
  const flagInvalid = () => { invalidFields = true; };
  async function run(operation, request) {
    // Record a request only after an attempt to invoke the original interface.
    // Invalid text in the capture never mutates data supplied to Host/source.
    const req = requestFor(operation, request, flagInvalid);
    try {
      const value = await reading[operation](request);
      const response = responseFor(operation, value, flagInvalid);
      const record = {
        sequence: records.length + 1, operation, request: req,
        outcome: operation === 'lookup' && response.lookupFailureCode
          ? 'SOURCE_FAILURE' : 'RESULT',
        response,
        ...(operation === 'pages' ? { replayability: 'READER_URLS_REDACTED' } : {}),
      };
      const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
      if (records.length >= maxRecords || byteCount + bytes > maxBytes) budgetExceeded = true;
      else { records.push(record); byteCount += bytes; }
      return value;
    } catch (error) {
      const record = {
        sequence: records.length + 1, operation, request: req,
        outcome: 'SOURCE_ERROR', failure: safeError(error),
      };
      const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
      if (records.length >= maxRecords || byteCount + bytes > maxBytes) budgetExceeded = true;
      else { records.push(record); byteCount += bytes; }
      throw error;
    }
  }
  return {
    reading: {
      lookup: input => run('lookup', input),
      chapters: input => run('chapters', input),
      pages: input => run('pages', input),
    },
    finalize() {
      const report = {
        schemaVersion: 1,
        captureKind: 'REAL_PROVIDER_NORMALIZED_ENVELOPES',
        caseId, observedAt, providerId: 'app.tsuzuki.mangaall',
        providerCode, packageSha256,
        sourceNetworkStage: 'RECORDED_BY_LIVE_CALLER_NOT_VERIFIED_HERE',
        canonicalStage: 'NOT_EXECUTED_HOST',
        readerStage: 'PAGE_METADATA_ONLY_NOT_REPLAYABLE',
        replayCompleteness: budgetExceeded ? 'INCOMPLETE_BUDGET_EXCEEDED'
          : invalidFields ? 'INCOMPLETE_REJECTED_FIELDS' : 'LOOKUP_CHAPTERS_ONLY',
        records,
      };
      return { ...report, sha256: createHash('sha256')
        .update(JSON.stringify(report)).digest('hex') };
    },
  };
}
