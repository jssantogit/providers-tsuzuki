// Opt-in, read-only live matrix for the single MangaAll provider.
// Probes exact observed works; no image downloads, trust-root changes,
// cookies, Browser challenge bypass, Reader authorization or publication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHttpBridge } from './mangaall_live_probe_core.mjs';

const catalog = JSON.parse(fs.readFileSync('tooling/mangaall_case_matrix.json', 'utf8'));
const selectedSuite = process.argv.includes('--self-test') ? 'core' : (process.env.MANGAALL_SUITE || 'core');
if (!['core', 'manga', 'manhwa', 'webtoon', 'manhua', 'prose'].includes(selectedSuite)) {
  throw Error('MangaAll unknown live probe suite');
}
// Full catalog is tested deterministically in Provider CI. The live probe
// deliberately uses a small rotating sample: never fan out 65 titles at once.
const cases = (selectedSuite === 'core'
  ? catalog.cases.filter((item) => item.probe === 'source_metadata')
  : catalog.cases.filter((item) => item.suite === selectedSuite &&
      item.probe === 'discovery_only').slice(0, 4)
).map((item) => ({
  id: item.id, names: [item.title, ...item.aliases], work: item.knownWorkId ?? null,
  format: item.format, probe: item.probe, tags: item.tags,
}));
assert.ok(cases.length > 0);
const origins = {
  'https://api.mangadex.org': 'MANGADEX',
  'https://mangadot.net': 'MANGADOT',
  'https://mangafire.to': 'MANGAFIRE',
};
function normalize(v) {
  return typeof v === 'string' ? v.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '';
}
function exactWork(row, spec) {
  return typeof row?.externalWorkId === 'string' &&
    (spec.work == null || row.externalWorkId === spec.work) &&
    [row.title, ...(Array.isArray(row.aliases) ? row.aliases : [])]
      .some((value) => spec.names.some((name) => normalize(name) === normalize(value)));
}
function errorCode(error) {
  if (['CHALLENGE_BLOCKED', 'HTTP_ERROR', 'INVALID_RESPONSE'].includes(error?.lookupFailureCode)) {
    return error.lookupFailureCode;
  }
  const s = typeof error?.message === 'string' ? error.message : '';
  if (/challenge required/i.test(s)) return 'CHALLENGE_BLOCKED';
  const code = /HTTP ([1-5]\d\d)\b/.exec(s);
  if (code) return 'HTTP_' + code[1];
  if (error?.name === 'TimeoutError') return 'TIMEOUT';
  let cause = error;
  for (let i = 0; i < 4 && cause && typeof cause === 'object'; i++, cause = cause.cause) {
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(cause.code)) return 'DNS';
    if (['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH'].includes(cause.code)) return 'CONNECTION';
  }
  return 'UPSTREAM_OR_RUNTIME_ERROR';
}
function granted(url, grants) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.hash || (u.port && u.port !== '443')) return false;
    return grants.some((grant) => {
      if (!grant.startsWith('https://*.')) return grant === u.origin;
      const suffix = grant.slice('https://*.'.length);
      return u.hostname.endsWith('.' + suffix) && u.hostname.length > suffix.length + 1;
    });
  } catch { return false; }
}
async function probe(reading, spec, grants) {
  const result = { case: spec.id, format: spec.format, probe: spec.probe,
    expectedWork: spec.work, evidence: 'API_LIVE',
    lookup: 'UNKNOWN', chapters: 'UNKNOWN', pages: 'NOT_PROBED' };
  let found = null;
  let incomplete = false;
  const sourceNames = new Set();
  try {
    for (const title of spec.names) {
      let cursor = null;
      for (let i = 0; i < 2; i++) {
        const response = await reading.lookup({
          titles: [title], cursor, requestedLanguage: 'en',
          diagnosticsVersion: 2, editorialEvidenceVersion: 1, coverageEvidenceVersion: 1,
        });
        if (!Array.isArray(response?.items) || response.items.length > 500 ||
          (response.nextCursor != null && (typeof response.nextCursor !== 'string' || !response.nextCursor))) {
          result.lookup = 'INVALID_CONTRACT';
          break;
        }
        for (const row of response.items) {
          if (typeof row.externalWorkId === 'string') sourceNames.add(row.externalWorkId.split(':')[0]);
          if (exactWork(row, spec)) found = row;
        }
        cursor = response.nextCursor;
        if (!cursor || found) {
          if (cursor) incomplete = true;
          break;
        }
        if (i === 1) incomplete = true;
      }
      if (found || result.lookup === 'INVALID_CONTRACT') break;
    }
    result.sourcesSeen = [...sourceNames].filter((v) => ['mangafire', 'mangadex', 'mangadot'].includes(v)).sort();
    result.lookupComplete = !incomplete;
    if (result.lookup !== 'INVALID_CONTRACT') result.lookup = found
      ? (spec.work ? 'EXACT_WORK' : 'DISCOVERY_OBSERVED')
      : incomplete ? 'PARTIAL_NO_MATCH' : 'NO_MATCH';
    if (found) {
      result.authorsPresent = Array.isArray(found.authors) && found.authors.some((v) => normalize(v));
      result.detailVerified = ['VERIFIED_WITH_ALIASES', 'VERIFIED_NO_ALIASES'].includes(found.detailOutcome);
      result.coverage = ['OBSERVED', 'EMPTY', 'UNKNOWN', 'INVALID_RESPONSE'].includes(found.coverageOutcome)
        ? found.coverageOutcome : 'NOT_REPORTED';
      result.coverageCount = Number.isInteger(found.coverageObservedCount) &&
        found.coverageObservedCount >= 0 && found.coverageObservedCount <= 200 ? found.coverageObservedCount : null;
      result.coverageHasMore = typeof found.coverageHasMore === 'boolean' ? found.coverageHasMore : null;
    }
  } catch (error) {
    result.lookup = 'UPSTREAM_ERROR';
    result.lookupError = errorCode(error);
  }

  // Unknown IDs and non-comic formats must NOT be inferred from
  // title matches. Never issue chapter/page reads for discovery-only works.
  if (!spec.work) {
    result.chapters = 'NOT_TESTED';
    result.pages = 'NOT_TESTED';
    return result;
  }
  // The HIDs are independently known from the A54 capture. A read-only
  // chapters request is NOT a persisted Host edition binding.
  const binding = { providerId: 'app.tsuzuki.mangaall', externalWorkId: spec.work, facetId: 'en' };
  try {
    const page = await reading.chapters({ binding, cursor: null });
    if (!Array.isArray(page?.items) || page.items.length > 16000 ||
      page.items.some((v) => typeof v?.providerChapterId !== 'string' ||
        !v.providerChapterId.startsWith('mangafire:') || !Number.isFinite(v.rawNumber) ||
        v.rawNumber < 0 || (v.language != null && v.language !== 'en'))) {
      result.chapters = 'INVALID_CONTRACT';
      return result;
    }
    result.chapters = page.items.length ? 'OBSERVED' : page.nextCursor ? 'PARTIAL_EMPTY' : 'EMPTY';
    result.chapterFirstPageCount = page.items.length;
    result.chapterHasMore = page.nextCursor != null;
    result.chapterNumbersSample = page.items.slice(0, 5).map((v) => v.rawNumber);
    const first = page.items.find((v) => v.rawNumber === 1);
    if (first) {
      try {
        const delivery = await reading.pages({
          binding, providerChapterId: first.providerChapterId, diagnosticsVersion: 2,
        });
        if (delivery?.type === 'page_failure') {
          result.pages = 'TYPED_FAILURE';
          result.pageFailureStage = typeof delivery.pageFailureStage === 'string' &&
            /^[A-Z_]{1,60}$/.test(delivery.pageFailureStage) ? delivery.pageFailureStage : 'UNCLASSIFIED';
        } else if (delivery?.type === 'page_list' && Array.isArray(delivery.pages) &&
          delivery.pages.length > 0 && delivery.pages.length <= 5000) {
          result.pages = 'METADATA_OBSERVED';
          result.pageCount = delivery.pages.length;
          result.pageOriginsAllowed = delivery.pages.every((item) => granted(item?.url, grants));
        } else {
          result.pages = 'INVALID_CONTRACT';
        }
      } catch (error) {
        result.pages = 'UPSTREAM_ERROR';
        result.pagesError = errorCode(error);
      }
    } else result.pages = 'CHAPTER_ONE_NOT_IN_FIRST_PAGE';
  } catch (error) {
    result.chapters = 'UPSTREAM_ERROR';
    result.chaptersError = errorCode(error);
  }
  return result;
}
function verdict(v) {
  if ([v.lookup, v.chapters, v.pages].includes('INVALID_CONTRACT') || v.pageOriginsAllowed === false) {
    return 'FAIL_CONTRACT';
  }
  if (v.probe === 'discovery_only') {
    return v.lookup === 'DISCOVERY_OBSERVED' ? 'OBSERVED_API_DISCOVERY' : 'INCONCLUSIVE';
  }
  return v.lookup === 'EXACT_WORK' && v.authorsPresent && v.detailVerified &&
    v.coverage === 'OBSERVED' && v.coverageCount > 0 &&
    v.chapters === 'OBSERVED' && v.pages === 'METADATA_OBSERVED' ? 'PASS_API' : 'INCONCLUSIVE';
}
if (process.argv.length === 3 && process.argv[2] === '--self-test') {
  const fake = {
    async lookup() { return { items: [{
      externalWorkId: 'mangafire:zk12', title: 'Goodnight Punpun', authors: ['Inio Asano'],
      detailOutcome: 'VERIFIED_WITH_ALIASES', coverageOutcome: 'OBSERVED', coverageObservedCount: 3,
    }], nextCursor: null }; },
    async chapters() { return { items: [{
      providerChapterId: 'mangafire:chapter-1', rawNumber: 1, language: 'en',
    }], nextCursor: null }; },
    async pages() { return { type: 'page_list', pages: [{ url: 'https://img.mfcdn.cc/1.webp' }] }; },
  };
  const result = await probe(fake, cases[0], ['https://*.mfcdn.cc']);
  assert.equal(verdict(result), 'PASS_API');
  assert.equal(granted('https://img.mfcdn.cc/1.webp', ['https://*.mfcdn.cc']), true);
  assert.equal(granted('https://evil-mfcdn.cc/1.webp', ['https://*.mfcdn.cc']), false);
  assert.equal(granted('http://img.mfcdn.cc/1.webp', ['https://*.mfcdn.cc']), false);
  assert.equal(granted('https://u:p@img.mfcdn.cc/1.webp', ['https://*.mfcdn.cc']), false);
  const bad = await probe({ ...fake, async chapters() {
    return { items: [{ providerChapterId: 'mangafire:wrong', rawNumber: 1, language: 'pt-br' }] };
  } }, cases[0], ['https://*.mfcdn.cc']);
  assert.equal(verdict(bad), 'FAIL_CONTRACT');
  const unavailable = await probe({ ...fake, async lookup() {
    throw new Error('MangaFire challenge required https://private.example');
  }, async chapters() { return { items: [] }; } }, cases[0], ['https://*.mfcdn.cc']);
  assert.equal(unavailable.lookupError, 'CHALLENGE_BLOCKED');
  assert.equal(verdict(unavailable), 'INCONCLUSIVE');
  assert.equal(JSON.stringify(unavailable).includes('private.example'), false);
  console.log('MangaAll 0.5.2 live-matrix offline contract: PASS');
  process.exit(0);
}
if (process.argv.length !== 5 || process.argv[2] !== '--live' || process.argv[3] !== '--output' ||
    !/^[\w./-]+\.json$/.test(process.argv[4]) || process.argv[4].includes('..')) {
  console.error('Usage: node tooling/mangaall_live_matrix.mjs --live --output mangaall-live.json');
  process.exit(2);
}
const root = path.resolve('providers/mangaall');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.id !== 'app.tsuzuki.mangaall' || manifest.version.code < 7 ||
    !['preview', 'development'].includes(manifest.publication)) {
  throw new Error('Expected unpublished, single-provider MangaAll code7+');
}
const grants = manifest.permissions.network.origins;
if (!Object.keys(origins).every((origin) => grants.includes(origin))) {
  throw new Error('Missing reviewed API origin');
}
const requests = [];
const blockedOrigins = new Set();
const bridges = new Map(Object.keys(origins).map((origin) => [origin, createHttpBridge({
  origin, maxRequests: origins[origin] === 'MANGAFIRE' ? 12 : 24,
  maxResponseBytes: 192 * 1024, timeoutMs: 12000,
  fetchImpl: async (url, options) => {
    const start = performance.now();
    try {
      const response = await fetch(url, options);
      if (response.status === 403 && origins[origin] === 'MANGAFIRE') blockedOrigins.add(origin);
      requests.push({ source: origins[origin], status: response.status,
        elapsedMs: Math.round(performance.now() - start) });
      return response;
    } catch (error) {
      requests.push({ source: origins[origin], status: null,
        elapsedMs: Math.round(performance.now() - start), outcome: 'TRANSPORT_ERROR' });
      throw error;
    }
  },
})]));
globalThis.tsuzuki = { http: { async request(method, url, headers, body) {
  let origin;
  try { origin = new URL(url).origin; } catch { throw Error('Invalid API destination'); }
  const bridge = bridges.get(origin);
  if (!bridge) throw Error('Unauthorized API origin');
  // Stop re-requesting an upstream that already challenged this runner.
  // No bypass or retry, and do not invent a completed empty result.
  if (blockedOrigins.has(origin)) throw Error('MangaFire challenge required');
  return bridge.request(method, url, headers, body);
} } };
const provider = (await import(pathToFileURL(path.join(root, 'main.js')).href)).default;
if (!provider?.reading || !['lookup', 'chapters', 'pages']
  .every((method) => typeof provider.reading[method] === 'function')) {
  throw Error('Unified MangaAll reading contract not found');
}
const results = [];
for (const spec of cases) {
  const before = requests.length;
  const value = await probe(provider.reading, spec, grants);
  const observed = requests.slice(before);
  value.httpBySource = Object.fromEntries(['MANGADEX', 'MANGADOT', 'MANGAFIRE'].map((source) => {
    const sample = observed.filter((item) => item.source === source);
    return [source, {
      requests: sample.length,
      ok: sample.filter((item) => item.status === 200).length,
      blocked403: sample.filter((item) => item.status === 403).length,
      transportFailed: sample.filter((item) => item.status == null).length,
    }];
  }));
  // A blocked internal MangaFire source makes a unified NO_MATCH inconclusive,
  // even when the competing sources returned HTTP 200. Never assert no chapters.
  if (['NO_MATCH', 'PARTIAL_NO_MATCH'].includes(value.lookup) &&
      (value.httpBySource.MANGAFIRE.blocked403 > 0 || blockedOrigins.has('https://mangafire.to'))) {
    value.lookup = 'MANGAFIRE_CHALLENGE_BLOCKED';
    value.lookupError = 'HTTP_403';
  }
  results.push({ ...value, verdict: verdict(value) });
}
const report = { schema: 1, provider: manifest.id, version: manifest.version.name,
  headSha: process.env.GITHUB_SHA || 'local', observedAt: new Date().toISOString(),
  selectedSuite, catalogSize: catalog.cases.length, selectedCaseCount: cases.length,
  scope: 'LIVE_SOURCE_METADATA_ONLY_NO_FORMAT_PROOF_NOT_ANDROID_NOT_CANONICAL_RECONCILIATION',
  requests, cases: results };
fs.writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
for (const value of results) {
  console.log(JSON.stringify({ case: value.case, verdict: value.verdict, lookup: value.lookup,
    coverage: value.coverage || 'N/A', chapters: value.chapters, pages: value.pages,
    lookupError: value.lookupError || null, chaptersError: value.chaptersError || null,
    pagesError: value.pagesError || null, pageFailureStage: value.pageFailureStage || null }));
}
const counts = Object.create(null);
for (const value of requests) {
  const key = value.source + ':' + (value.status == null ? 'TRANSPORT' : value.status);
  counts[key] = (counts[key] || 0) + 1;
}
console.log('MangaAll metadata requests=' + requests.length + ' by_source_status=' +
  JSON.stringify(Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))));
if (results.some((value) => value.verdict === 'FAIL_CONTRACT')) process.exitCode = 1;
