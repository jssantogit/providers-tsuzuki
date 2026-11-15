// Opt-in, read-only live matrix for the single MangaAll provider.
// Probes exact observed works; no image downloads, trust-root changes,
// cookies, Browser challenge bypass, Reader authorization or publication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHttpBridge } from './mangaall_live_probe_core.mjs';
import { probeJourney as probe, journeyVerdict as verdict, granted } from './mangaall_live_journey_core.mjs';

const catalog = JSON.parse(fs.readFileSync('tooling/mangaall_case_matrix.json', 'utf8'));
// This opt-in selector is usable while the workflow exists only on a feature
// branch. GitHub's workflow_dispatch UI requires a default-branch workflow.
const selection = JSON.parse(fs.readFileSync('tooling/mangaall_live_selection.json', 'utf8'));
const selfTest = process.argv.includes('--self-test');
const selectedSuite = selfTest ? 'core' : (process.env.MANGAALL_SUITE || selection.suite);
const selectedBatch = selfTest ? 1 : Number(process.env.MANGAALL_BATCH || selection.batch);
if (!['core', 'cross-format', 'identity', 'manga', 'manhwa', 'webtoon', 'manhua', 'prose'].includes(selectedSuite) ||
    !Number.isInteger(selectedBatch) || selectedBatch < 1 || selectedBatch > 7 ||
    (['core', 'cross-format', 'identity'].includes(selectedSuite) && selectedBatch !== 1)) {
  throw Error('MangaAll invalid live probe suite/batch');
}
// Full catalog is tested deterministically in Provider CI. The live probe
// deliberately uses a small rotating sample: never fan out 65 titles at once.
// Cross-format is a deliberately bounded real upstream sample (seven works),
// not the full 67-title deterministic regression suite. Non-comic titles stay lookup-only.
const CROSS_FORMAT_IDS = new Set([
  'punpun', 'koe', 'chainsaw-man', 'the-horizon', 'tower-of-god',
  'tales-demons', 'shadow-slave-wn',
]);
const IDENTITY_IDS = new Set(['punpun', 'koe', 'akame-ga-kill', 'ao-no-hako']);
const cases = (selectedSuite === 'core'
  ? catalog.cases.filter((item) => item.probe === 'source_metadata')
  : selectedSuite === 'cross-format'
    ? catalog.cases.filter((item) => CROSS_FORMAT_IDS.has(item.id))
    : selectedSuite === 'identity'
      ? catalog.cases.filter((item) => IDENTITY_IDS.has(item.id))
    : catalog.cases.filter((item) => item.suite === selectedSuite &&
        item.probe === 'discovery_only').slice((selectedBatch - 1) * 4, selectedBatch * 4)
).map((item) => ({
  id: item.id, names: [item.title, ...item.aliases], work: item.knownWorkId ?? null,
  format: item.format, probe: item.probe, tags: item.tags,
}));
assert.ok(cases.length > 0);
if (selectedSuite === 'cross-format') assert.equal(cases.length, 7);
if (selectedSuite === 'identity') assert.equal(cases.length, 4);
const origins = {
  'https://api.mangadex.org': 'MANGADEX',
  'https://mangadot.net': 'MANGADOT',
  'https://mangafire.to': 'MANGAFIRE',
};
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
  assert.deepEqual(result.matchingSources, ['mangafire'],
    'live evidence must identify which internal source returned the candidate');
  assert.equal(result.matchingWorkCount, 1);
  let prohibitedChapterCalls = 0;
  const novelResult = await probe({ ...fake,
    async chapters() { prohibitedChapterCalls++; throw Error('PROSE_READER_NOT_SUPPORTED'); },
    async pages() { prohibitedChapterCalls++; throw Error('PROSE_READER_NOT_SUPPORTED'); },
  }, {
    id: 'novel-boundary', names: ['Goodnight Punpun'], work: null,
    format: 'web_novel', probe: 'discovery_only',
  }, ['https://*.mfcdn.cc']);
  assert.equal(novelResult.lookup, 'DISCOVERY_OBSERVED');
  assert.equal(novelResult.chapters, 'FORMAT_BOUNDARY');
  assert.equal(novelResult.pages, 'NOT_TESTED');
  assert.equal(prohibitedChapterCalls, 0,
    'comic discovery cannot authorize a novel chapter or Reader call');
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
  console.log('MangaAll code8 live-matrix offline contract: PASS');
  process.exit(0);
}
if (process.argv.length !== 5 || process.argv[2] !== '--live' || process.argv[3] !== '--output' ||
    !/^[\w./-]+\.json$/.test(process.argv[4]) || process.argv[4].includes('..')) {
  console.error('Usage: node tooling/mangaall_live_matrix.mjs --live --output mangaall-live.json');
  process.exit(2);
}
const root = path.resolve('providers/mangaall');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.id !== 'app.tsuzuki.mangaall' || manifest.version.code < 8 ||
    !['preview', 'development'].includes(manifest.publication)) {
  throw new Error('Expected unpublished, single-provider MangaAll code8+');
}
const grants = manifest.permissions.network.origins;
if (!Object.keys(origins).every((origin) => grants.includes(origin))) {
  throw new Error('Missing reviewed API origin');
}
const requests = [];
const blockedOrigins = new Set();
const bridges = new Map(Object.keys(origins).map((origin) => [origin, createHttpBridge({
  origin, maxRequests: origins[origin] === 'MANGAFIRE' ? 20 : 40,
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
  const value = await probe(provider.reading, spec, grants, {
    lookupPageLimit: 2, chapterPageLimit: 4,
  });
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
  // A known blocked internal source invalidates any claim of exhaustive
  // unified discovery, even if MangaDex/MangaDot completed and chapter/page
  // metadata from one of them is sound. Never report a terminal no-match or
  // definitive editorial edition choice while MangaFire was unavailable.
  if (blockedOrigins.has('https://mangafire.to')) {
    value.sourceUnavailable = 'MANGAFIRE_CHALLENGE_BLOCKED';
    value.lookupComplete = false;
    if (['NO_MATCH', 'PARTIAL_NO_MATCH'].includes(value.lookup)) {
      value.lookup = 'MANGAFIRE_CHALLENGE_BLOCKED';
    }
    if (value.httpBySource.MANGAFIRE.blocked403 > 0) value.lookupError = 'HTTP_403';
  }
  results.push({ ...value, verdict: verdict(value) });
}
const report = { schema: 1, provider: manifest.id, version: manifest.version.name,
  headSha: process.env.GITHUB_SHA || 'local', observedAt: new Date().toISOString(),
  selectedSuite, selectedBatch, catalogSize: catalog.cases.length, selectedCaseCount: cases.length,
  scope: 'LIVE_API_LOOKUP_PAGINATED_CHAPTERS_AND_PAGE_METADATA_ONLY_NOT_CANONICAL_NOT_READER_PIXELS',
  requests, cases: results };
fs.writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
for (const value of results) {
  console.log(JSON.stringify({ case: value.case, verdict: value.verdict, lookup: value.lookup,
    coverage: value.coverage || 'N/A', chapters: value.chapters, pages: value.pages,
    lookupComplete: value.lookupComplete, lookupPages: value.lookupPages,
    chapterPages: value.chapterPages, chapterCount: value.chapterCount,
    chapterHasMore: value.chapterHasMore, chapterOnePresent: value.chapterOnePresent,
    sameSourceRivals: value.sameSourceRivals, numberingGapObserved: value.numberingGapObserved,
    sourceAuthorDisagreement: value.sourceAuthorDisagreement,
    sourceUnavailable: value.sourceUnavailable || null,
    lookupError: value.lookupError || null, chaptersError: value.chaptersError || null,
    pagesError: value.pagesError || null, pageFailureStage: value.pageFailureStage || null,
    matchingWorkCount: value.matchingWorkCount ?? 0,
    matchingSources: value.matchingSources || [] }));
}
const verdictCounts = Object.create(null);
for (const value of results) verdictCounts[value.verdict] = (verdictCounts[value.verdict] || 0) + 1;
console.log('MangaAll journey verdict_counts=' + JSON.stringify(verdictCounts));
const counts = Object.create(null);
for (const value of requests) {
  const key = value.source + ':' + (value.status == null ? 'TRANSPORT' : value.status);
  counts[key] = (counts[key] || 0) + 1;
}
console.log('MangaAll metadata requests=' + requests.length + ' by_source_status=' +
  JSON.stringify(Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))));
if (results.some((value) => value.verdict === 'FAIL_CONTRACT')) process.exitCode = 1;
