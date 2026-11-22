// Opt-in, read-only live matrix for the single MangaAll provider.
// Probes actual upstream data for operator-supplied works or legacy curated
// suites; no image downloads, trust-root changes, cookies, browser challenge
// bypass, Host canonical authority or Reader/pixel guarantees.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHttpBridge } from './mangaall_live_probe_core.mjs';
import { parseWorks, shardWorks } from './mangaall_generic_works.mjs';
import { createRealEnvelopeCapture } from './mangaall_real_envelope_capture.mjs';
import { inspectCurrentSignedCode9Source, CODE9_OPT_IN } from './mangaall_signed_code9_smoke_gate.mjs';
import { inspectCurrentSignedCode10Source, CODE10_OPT_IN } from './mangaall_signed_code10_smoke_gate.mjs';
import { probeJourney as probe, journeyVerdict as verdict, granted } from './mangaall_live_journey_core.mjs';

// Preset data is never read in generic custom mode: no fixed title corpus
// participates in parsing or evaluating operator-supplied works.
// The opt-in selector remains for legacy curated compatibility suites.
const selection = JSON.parse(fs.readFileSync('tooling/mangaall_live_selection.json', 'utf8'));
const selfTest = process.argv.includes('--self-test');
const selectedSuite = selfTest ? 'core' : (process.env.MANGAALL_SUITE || selection.suite);
const catalog = selectedSuite === 'custom'
  ? { cases: [] }
  : JSON.parse(fs.readFileSync('tooling/mangaall_case_matrix.json', 'utf8'));
const selectedBatch = selfTest ? 1 : Number(process.env.MANGAALL_BATCH || selection.batch);
if (!['custom', 'core', 'cross-format', 'identity', 'manga', 'manhwa', 'webtoon', 'manhua', 'prose'].includes(selectedSuite) ||
    !Number.isInteger(selectedBatch) || selectedBatch < 1 || selectedBatch > 7 ||
    (['custom', 'core', 'cross-format', 'identity'].includes(selectedSuite) && selectedBatch !== 1)) {
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
const allCases = (selectedSuite === 'custom'
  ? parseWorks(process.env.MANGAALL_WORKS || '')
  : selectedSuite === 'core'
  ? catalog.cases.filter((item) => item.probe === 'source_metadata')
  : selectedSuite === 'cross-format'
    ? catalog.cases.filter((item) => CROSS_FORMAT_IDS.has(item.id))
    : selectedSuite === 'identity'
      ? catalog.cases.filter((item) => IDENTITY_IDS.has(item.id))
    : catalog.cases.filter((item) => item.suite === selectedSuite &&
        item.probe === 'discovery_only').slice((selectedBatch - 1) * 4, selectedBatch * 4)
).map((item) => item.names ? item : ({
  id: item.id, names: [item.title, ...item.aliases], work: item.knownWorkId ?? null,
  format: item.format, probe: item.probe, tags: item.tags,
}));
const shardIndex = Number(process.env.MANGAALL_SHARD_INDEX ?? 0);
const shardCount = Number(process.env.MANGAALL_SHARD_COUNT ?? 1);
const cases = selectedSuite === 'custom'
  ? shardWorks(allCases, shardIndex, shardCount)
  : allCases;
assert.ok(cases.length > 0 || selectedSuite === 'custom',
  'curated runs must receive at least one work; generic idle shards are allowed');
if (selectedSuite === 'cross-format') assert.equal(cases.length, 7);
if (selectedSuite === 'identity') assert.equal(cases.length, 4);
// Inspect precisely which operator-supplied works would be queried without
// making any network request. This is a configuration gate, NOT a live verdict.
if (process.argv.length === 3 && process.argv[2] === '--plan') {
  console.log(JSON.stringify({
    mode: selectedSuite, shardIndex, shardCount, inputCaseCount: allCases.length,
    selectedCaseCount: cases.length, cases: cases.map((item) => ({
      id: item.id, title: item.names[0], format: item.format,
      sourceWorkId: item.work, probe: item.probe,
    })),
    authority: 'NO_SOURCE_OR_CANONICAL_EVIDENCE_COLLECTED',
  }));
  process.exit(0);
}
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
  console.log('MangaAll V1 live-matrix offline contract: PASS');
  process.exit(0);
}
const captureOutput = process.argv.length === 7 && process.argv[5] === '--real-envelopes'
  ? process.argv[6] : null;
if (![5, 7].includes(process.argv.length) || process.argv[2] !== '--live' ||
    process.argv[3] !== '--output' || (process.argv.length === 7 && !captureOutput) ||
    !/^[\w./-]+\.json$/.test(process.argv[4]) || process.argv[4].includes('..') ||
    (captureOutput && (!/^[\w./-]+\.json$/.test(captureOutput) ||
      captureOutput.includes('..') || captureOutput === process.argv[4]))) {
  console.error('Usage: node tooling/mangaall_live_matrix.mjs --live --output source.json ' +
    '[--real-envelopes normalized-source.json]');
  process.exit(2);
}
const root = path.resolve('providers/mangaall');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const legacyReadOnly = manifest.id === 'app.tsuzuki.mangaall' &&
  manifest.version.code >= 8 && ['preview', 'development'].includes(manifest.publication);
const officialCode9 = manifest.id === 'app.tsuzuki.mangaall' &&
  manifest.version.code === 9 && manifest.version.name === '0.5.4' &&
  manifest.publication === 'release';
const officialCode10 = manifest.id === 'app.tsuzuki.mangaall' &&
  manifest.version.code === 10 && manifest.version.name === '0.5.5' &&
  manifest.publication === 'release';
// A published code9 source is NOT allowed into the older unsigned source
// runner by accident. Require strict consent and the real P-256 verifier
// before any HTTP requests or captured Host envelopes.
if (!legacyReadOnly && !officialCode9 && !officialCode10) {
  throw new Error('MangaAll live source requires reviewed legacy or authentic signed code9/code10');
}
if (officialCode9) {
  if (process.env.MANGAALL_SIGNED_CODE9_CANONICAL_SMOKE !== CODE9_OPT_IN) {
    throw new Error('Official code9 smoke requires explicit signed-source authorization');
  }
  inspectCurrentSignedCode9Source(process.env.MANGAALL_SIGNED_CODE9_CANONICAL_SMOKE);
}
if (officialCode10) {
  // Only current truly P-256 signed seq36 and exact lock/source bytes.
  // Neither a dev candidate nor a similarly named unsigned package qualifies.
  if (process.env.MANGAALL_SIGNED_CODE10_CANONICAL_SMOKE !== CODE10_OPT_IN) {
    throw new Error('Official code10 smoke requires explicit signed-source authorization');
  }
  if (process.env.MANGAALL_SIGNED_CODE9_CANONICAL_SMOKE) {
    throw new Error('Historical code9 opt-in may never authorize a code10 capture');
  }
  inspectCurrentSignedCode10Source(process.env.MANGAALL_SIGNED_CODE10_CANONICAL_SMOKE);
}
const grants = manifest.permissions.network.origins;
if (!Object.keys(origins).every((origin) => grants.includes(origin))) {
  throw new Error('Missing reviewed API origin');
}
const requests = [];
const blockedOrigins = new Set();
const bridges = new Map(Object.keys(origins).map((origin) => [origin, createHttpBridge({
  origin, maxRequests: selectedSuite === 'custom'
    ? (origins[origin] === 'MANGAFIRE' ? 80 : 120)
    : (origins[origin] === 'MANGAFIRE' ? 20 : 40),
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
// Real normalized lookup/chapter envelopes can be exported separately for
// the future Host Kotlin gateway. This captures the actual running Provider,
// never a summary reconstructed into invented candidates. Page CDN URLs are
// always redacted and therefore cannot be replayed as Reader pixels.
const observedAt = new Date().toISOString();
const signedPayload = captureOutput
  ? JSON.parse(fs.readFileSync('dist/index.payload.json', 'utf8')) : null;
const signedEntry = signedPayload?.providers?.find(x => x.providerId === manifest.id);
if (captureOutput) {
  if (signedPayload.repositoryId !== 'app.tsuzuki.providers' ||
      signedEntry?.versionCode !== manifest.version.code ||
      !/^[a-f0-9]{64}$/u.test(signedEntry?.sha256 || '')) {
    throw Error('Real source capture requires published signed MangaAll identity');
  }
  const artifact = fs.readFileSync(
    `dist/providers/app.tsuzuki.mangaall-${signedEntry.versionCode}.tsz`);
  if (createHash('sha256').update(artifact).digest('hex') !== signedEntry.sha256) {
    throw Error('Real source capture refuses artifact hash mismatch');
  }
}
const realCaptures = [];
const results = [];
for (const spec of cases) {
  const before = requests.length;
  const recording = captureOutput
    ? createRealEnvelopeCapture(provider.reading, {
      caseId: spec.id, observedAt, providerCode: manifest.version.code,
      packageSha256: signedEntry.sha256,
    }) : null;
  const value = await probe(recording?.reading ?? provider.reading, spec, grants, {
    // Code9 diagnosticsVersion=2 yields V2 observations WITHOUT V1 items;
    // the canonical smoke must use the signed V1 interface explicitly.
    lookupContract: (officialCode9 || officialCode10) ? 'v1' : 'legacy',
    // Real signed code10 canonical Host collector collects up to 8
    // lookup pages. Recording only 3 created an internal REPLAY_GAP for
    // Naruto/Bleach, whose third page still had an upstream cursor.
    // This is a capture budget, never evidence of complete source coverage.
    lookupPageLimit: selectedSuite === 'custom' && officialCode10 ? 8
      : selectedSuite === 'custom' ? 3 : 2,
    chapterPageLimit: selectedSuite === 'custom' ? 8 : 4,
    includeCandidates: selectedSuite === 'custom',
    includeCandidateCoverage: selectedSuite === 'custom',
    candidatePreviewLimit: 3, candidateChapterPageLimit: 2,
  
  });
  const observed = requests.slice(before);
  if (recording) realCaptures.push(recording.finalize());
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
  results.push({
    ...value, requestedTitle: selectedSuite === 'custom' ? spec.names[0] : undefined,
    // This is always upstream evidence, never the real Kotlin canonical
    // chapter reconciliation or an Android Reader-pixel claim.
    canonicalStage: 'NOT_EXECUTED_HOST',
    readerPixelStage: 'NOT_EXECUTED_HOST',
    verdict: verdict(value),
  });
}
const report = { schema: 1, provider: manifest.id, version: manifest.version.name,
  headSha: process.env.GITHUB_SHA || 'local', observedAt: new Date().toISOString(),
  selectedSuite, selectedBatch, selectionSource: selectedSuite === 'custom'
    ? 'USER_INPUT' : 'CURATED_COMPATIBILITY',
  shardIndex: selectedSuite === 'custom' ? shardIndex : 0,
  shardCount: selectedSuite === 'custom' ? shardCount : 1,
  inputCaseCount: allCases.length, selectedCaseCount: cases.length,
  shardOutcome: cases.length ? 'REAL_SOURCE_ATTEMPTED' : 'NO_WORK_ASSIGNED',
  scope: 'LIVE_API_LOOKUP_PAGINATED_CHAPTERS_AND_PAGE_METADATA_ONLY_NOT_CANONICAL_NOT_READER_PIXELS',
  requests, cases: results };
fs.writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
if (captureOutput) {
  const capture = {
    schemaVersion: 1,
    captureKind: 'REAL_PROVIDER_NORMALIZED_ENVELOPE_BATCH',
    origin: 'LIVE_SIGNED_PROVIDER_JS',
    providerId: manifest.id,
    providerVersionCode: manifest.version.code,
    repositoryId: signedPayload.repositoryId,
    signedIndexSequence: signedPayload.sequence,
    packageSha256: signedEntry.sha256,
    observedAt,
    selectionSource: selectedSuite === 'custom' ? 'USER_INPUT' : 'CURATED_COMPATIBILITY',
    shardIndex: selectedSuite === 'custom' ? shardIndex : 0,
    shardCount: selectedSuite === 'custom' ? shardCount : 1,
    // No independent catalog identity was verified here. Never promote an
    // apparent unique API candidate into an editorial/canonical Host claim.
    catalogStage: 'NOT_EXECUTED_HOST',
    canonicalStage: 'NOT_EXECUTED_HOST',
    readerPixelStage: 'NOT_EXECUTED_HOST',
    captureOutcome: cases.length ? 'SOURCE_ATTEMPTS_RECORDED' : 'NO_WORK_ASSIGNED',
    cases: realCaptures,
  };
  const hash = createHash('sha256').update(JSON.stringify(capture)).digest('hex');
  fs.writeFileSync(captureOutput, JSON.stringify({ ...capture, sha256: hash }, null, 2) + '\n');
  console.log('MANGAALL_REAL_ENVELOPES|scope=LOOKUP_CHAPTERS_ONLY|cases=' +
    realCaptures.length + '|catalog=NOT_EXECUTED_HOST|readerPixels=NOT_EXECUTED_HOST');
}
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
    matchingSources: value.matchingSources || [],
    candidateCount: value.candidateCount ?? null,
    candidatePreviews: value.candidateChapterPreviews?.length ?? 0,
    candidatePreviewsTruncated: value.candidatePreviewsTruncated ?? false,
    canonicalStage: value.canonicalStage, readerPixelStage: value.readerPixelStage }));
}
if (selectedSuite === 'custom' && cases.length === 0) {
  console.log('MANGAALL_GENERIC_SHARD|outcome=NO_WORK_ASSIGNED|sourceRequests=0');
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
