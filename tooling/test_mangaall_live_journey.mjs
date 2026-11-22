import assert from 'node:assert/strict';
import fs from 'node:fs';
import { probeJourney, journeyVerdict, granted } from './mangaall_live_journey_core.mjs';

const catalog = JSON.parse(fs.readFileSync('tooling/mangaall_case_matrix.json', 'utf8'));
const grants = ['https://*.mfcdn.cc', 'https://mfcdn.cc', 'https://mangafire.to'];
const withId = (spec) => spec.work || 'mangafire:fixture-' + spec.id;
const chapter = (id, n) => ({
  providerChapterId: id + '-chapter-' + n,
  rawLabel: 'Chapter ' + n, rawNumber: n, language: 'en',
});
const candidate = (spec) => ({
  title: spec.names[0], aliases: spec.names.slice(1),
  externalWorkId: withId(spec),
  language: 'en', authors: ['Provenance Source Author'],
  detailOutcome: 'VERIFIED_NO_ALIASES',
  coverageOutcome: 'OBSERVED', coverageObservedCount: 2,
  coverageHasMore: true,
});
const specFor = (item) => ({
  id: item.id, format: item.format, probe: item.probe,
  names: [item.title, ...item.aliases], work: item.knownWorkId || null,
});
function harness(spec, overrides = {}) {
  const stats = { lookup: 0, chapters: 0, pages: 0, cursors: [] };
  const reading = {
    async lookup() {
      stats.lookup++;
      return { items: [candidate(spec)], nextCursor: null };
    },
    async chapters({ binding, cursor }) {
      stats.chapters++;
      stats.cursors.push(cursor);
      assert.equal(binding.providerId, 'app.tsuzuki.mangaall');
      assert.equal(binding.externalWorkId, withId(spec));
      return cursor === null || cursor === undefined
        ? { items: [chapter(withId(spec), 1)], nextCursor: 'page-two' }
        : { items: [chapter(withId(spec), 2)], nextCursor: null };
    },
    async pages({ binding, providerChapterId }) {
      stats.pages++;
      assert.equal(binding.externalWorkId, withId(spec));
      assert.equal(providerChapterId, chapter(withId(spec), 1).providerChapterId);
      return { type: 'page_list', pages: [
        { url: 'https://img.mfcdn.cc/fixture-1.png', headers: { Referer: 'https://mangafire.to' } },
      ] };
    },
    ...overrides,
  };
  return { reading, stats };
}

// Every curated title, including obscure works and edition-shaped names, is
// run through the same collector. Responses below are SYNTHETIC; the source
// names are the actual curated corpus, not a live-provider success claim.
const observedFormats = new Set();
let proseCases = 0;
let comicCases = 0;
for (const item of catalog.cases) {
  const spec = specFor(item);
  const { reading, stats } = harness(spec);
  const result = await probeJourney(reading, spec, grants);
  observedFormats.add(item.format);
  assert.equal(result.lookup, item.knownWorkId ? 'EXACT_WORK' : 'DISCOVERY_OBSERVED', item.id);
  assert.equal(result.lookupComplete, true, item.id);
  assert.equal(result.matchingWorkCount, 1, item.id);
  assert.equal(result.authority, 'SOURCE_METADATA_ONLY_NO_CANONICAL_OR_READER_PROOF');
  assert.equal(result.publicationFormatVerified, false, item.id);
  if (item.format === 'light_novel' || item.format === 'web_novel') {
    proseCases++;
    assert.equal(result.chapters, 'FORMAT_BOUNDARY', item.id);
    assert.equal(stats.chapters, 0, 'never turn novel homonym into comics reading');
    assert.equal(stats.pages, 0, 'no prose reader permission');
    assert.equal(journeyVerdict(result), 'OBSERVED_API_DISCOVERY');
  } else {
    comicCases++;
    assert.equal(result.chapters, 'COMPLETE', item.id);
    assert.equal(result.chapterPages, 2, item.id);
    assert.equal(result.chapterCount, 2, item.id);
    assert.equal(result.chapterOnePresent, true, item.id);
    assert.equal(result.chapterHasMore, false, item.id);
    assert.equal(result.pages, 'METADATA_OBSERVED', item.id);
    assert.deepEqual(stats.cursors, [null, 'page-two']);
    assert.equal(journeyVerdict(result), item.knownWorkId ? 'PASS_API' : 'SOURCE_JOURNEY_NOT_CANONICAL', item.id);
    assert.equal(result.sourceSelection,
      item.knownWorkId ? 'DEVICE_VERIFIED_HID' : 'UNVERIFIED_UNIQUE_API_CANDIDATE');
  }
}
assert.deepEqual([...observedFormats].sort(),
  ['light_novel', 'manga', 'manhua', 'manhwa', 'web_novel', 'webtoon']);
assert.equal(proseCases, 13);
assert.equal(comicCases, 54);

const base = specFor(catalog.cases.find((x) => x.id === 'punpun'));
const run = async (override, spec = base, options) => {
  const { reading, stats } = harness(spec, override);
  return { result: await probeJourney(reading, spec, grants, options), stats };
};

// Regression from first official signed code9 live smoke run #44759250361:
// that run accidentally asked diagnosticsVersion=2 and then treated a real V2
// observation envelope as a V1 ProviderPage, falsely reporting INVALID_CONTRACT
// for Naruto, Death Note and Bleach. Canonical/chapter capture must explicitly
// request the genuine V1 API; the V2 diagnostic must remain a separate protocol.
{
  const spec = specFor(catalog.cases.find((item) => item.id === 'punpun'));
  const live = harness(spec);
  const requested = [];
  const reading = {
    ...live.reading,
    async lookup(request) {
      requested.push(request);
      if (request.diagnosticsVersion === 2) {
        return {
          contractVersion: 2, providerId: 'app.tsuzuki.mangaall',
          state: 'PARTIAL_EVIDENCE', lookupComplete: false,
          observedCandidates: [], sourceStatuses: [],
          eligibleForCanonicalBinding: false, eligibleForReader: false,
        };
      }
      return { items: [candidate(spec)], nextCursor: null };
    },
  };
  const wrong = await probeJourney(reading, spec, grants, { lookupContract: 'legacy' });
  assert.equal(wrong.lookup, 'INVALID_CONTRACT',
    'V2 envelope cannot be silently treated as V1 source observations');
  assert.equal(journeyVerdict(wrong), 'FAIL_CONTRACT');
  const proper = await probeJourney(reading, spec, grants, { lookupContract: 'v1' });
  assert.equal(proper.lookup, 'EXACT_WORK');
  assert.equal(proper.lookupComplete, true);
  assert.equal(proper.chapters, 'COMPLETE');
  assert.equal(proper.pages, 'METADATA_OBSERVED');
  assert.notEqual(journeyVerdict(proper), 'FAIL_CONTRACT');
  assert.equal(requested[0].diagnosticsVersion, 2);
  for (const call of requested.slice(1)) {
    assert.equal(call.diagnosticsVersion, 1,
      'Host V1 wire serializes the default, not the V2 selector');
    assert.equal(call.editorialEvidenceVersion, 1,
      'Host JSON encodeDefaults=true emits its internal V1 DTO default');
    assert.equal(call.coverageEvidenceVersion, 1);
    assert.equal(call.requestedLanguage, 'en');
  }
  await assert.rejects(
    () => probeJourney(reading, spec, grants, { lookupContract: 'v2' }),
    /Invalid MangaAll live lookup contract/,
  );
}

// A source response with multiple same-name HIDs, including another
// apparently popular manga, MUST NOT authorize an unknown edition or Reader.
const unknown = { ...base, work: null };
let test = await run({ async lookup() {
  return { items: [candidate(unknown), {
    ...candidate(unknown), externalWorkId: 'mangafire:rival-123',
    authors: ['Another Author'],
  }], nextCursor: null };
}}, unknown);
assert.equal(test.result.unresolvedCandidates, true);
assert.equal(test.result.sameSourceRivals, true);
assert.equal(test.result.sourceAuthorDisagreement, true);
assert.equal(journeyVerdict(test.result), 'AMBIGUOUS_EDITION');
assert.equal(journeyVerdict({ ...test.result, lookupComplete: false }), 'PARTIAL_CANDIDATE_CONFLICT',
  'blocked rival sources cannot establish a complete edition decision');
assert.equal(test.stats.chapters, 0);
assert.equal(test.stats.pages, 0);

// A verified HID may be inspected but a rival source still prevents a
// claim that the chosen edition is the canonical one.
test = await run({ async lookup() {
  return { items: [candidate(base), {
    ...candidate(base), externalWorkId: 'mangadex:11111111-2222-4333-8444-555555555555',
  }], nextCursor: null };
}});
assert.equal(test.result.matchingWorkCount, 2);
assert.equal(test.result.sameSourceRivals, false);
assert.equal(journeyVerdict(test.result), 'AMBIGUOUS_EDITION');

// Finding a candidate on page 1 does not prove lookup exhaustiveness.
let requests = 0;
test = await run({ async lookup() {
  requests++;
  return { items: [candidate(base)], nextCursor: 'unseen-candidate-page-' + requests };
}});
assert.equal(test.result.lookupComplete, false);
assert.equal(test.result.lookupPages, 3 * base.names.length,
  'each alias has its own bounded cursor chain; stop before declaring complete');
assert.equal(test.stats.chapters, 0);
assert.equal(journeyVerdict(test.result), 'INCONCLUSIVE');

// Bounded chapter list exposes partial delivery and keeps the page
// metadata probe diagnostic, never labels the whole inventory complete.
test = await run({ async chapters({ cursor }) {
  return { items: [chapter(base.work, cursor ? 2 : 1)], nextCursor: cursor ? 'page-three' : 'page-two' };
}}, base, { chapterPageLimit: 2 });
assert.equal(test.result.chapters, 'PARTIAL_PAGE_LIMIT');
assert.equal(test.result.chapterCount, 2);
assert.equal(test.result.pages, 'METADATA_OBSERVED');
assert.equal(journeyVerdict(test.result), 'PARTIAL_CHAPTER_INVENTORY');

// Late network error with real earlier pages is partial, NOT empty or
// a completed count. No cursor progress is silently promoted.
test = await run({ async chapters({ cursor }) {
  if (cursor) throw Error('MangaFire challenge required https://private.example');
  return { items: [chapter(base.work, 1)], nextCursor: 'page-two' };
}});
assert.equal(test.result.chapters, 'PARTIAL_UPSTREAM_ERROR');
assert.equal(test.result.chaptersError, 'CHALLENGE_BLOCKED');
assert.equal(test.result.chapterCount, 1);
assert.equal(journeyVerdict(test.result), 'PARTIAL_CHAPTER_INVENTORY');
assert.equal(JSON.stringify(test.result).includes('private.example'), false);

// Real signed code8 returns a closed typed lookup failure when an internal
// source exhausts its retry. An empty result with lookupFailureCode MUST NOT
// become a complete no-match or a certified zero-chapter inventory.
test = await run({
  async lookup() {
    return {
      items: [], nextCursor: null, lookupFailureCode: 'HTTP_ERROR',
      lookupHttpStatus: 503,
    };
  },
});
assert.equal(test.result.lookupComplete, false);
assert.equal(test.result.lookupError, 'HTTP_ERROR');
assert.equal(test.result.lookup, 'UPSTREAM_ERROR');
assert.equal(journeyVerdict(test.result), 'INCONCLUSIVE');
assert.equal(test.stats.chapters, 0);
assert.equal(test.stats.pages, 0);

// Diagnostics expose a REAL A54-observed source ID, never a synthesized
// rival candidate. Existing adversarial contract tests cover artificial
// ambiguity separately; the opt-in LIVE run uses only upstream replies.
test = await run({ async lookup() {
  return { items: [{
    ...candidate(base), externalWorkId: 'mangafire:zk12',
    title: 'Goodnight Punpun', aliases: ['Oyasumi Punpun'],
    authors: ['Asano Inio'], coverageObservedCount: 200,
  }], nextCursor: null };
}}, base, { includeCandidates: true });
assert.equal(test.result.candidateSummaries.length, 1);
assert.equal(test.result.candidateSummaries[0].workId, 'mangafire:zk12');
assert.equal(test.result.candidateSummaries[0].coverageObservedCount, 200);
assert.equal(JSON.stringify(test.result).includes('https://'), false,
  'public candidate diagnostics must not export upstream URLs');

// Even with incomplete discovery, inspect chapter pages for the actual
// known Punpun HID *read-only*. The result remains noncanonical/inconclusive:
// candidate chapter delivery cannot authorize a preferred edition or Reader.
test = await run({
  async lookup() {
    return { items: [candidate(base)], nextCursor: 'source-next-unknown' };
  },
}, base, {
  lookupPageLimit: 1, includeCandidateCoverage: true,
  candidateChapterPageLimit: 2,
});
assert.equal(test.result.lookupComplete, false);
assert.equal(test.result.candidateChapterPreviews.length, 1);
assert.equal(test.result.candidateChapterPreviews[0].workId, 'mangafire:zk12');
assert.equal(test.result.candidateChapterPreviews[0].chapterCount, 2);
assert.equal(test.result.candidateChapterPreviews[0].chapterPages, 2);
assert.equal(test.result.candidateChapterPreviews[0].outcome, 'SOURCE_COMPLETE');
assert.equal(test.stats.pages, 0, 'candidate previews do not request Reader pages');
assert.equal(journeyVerdict(test.result), 'INCONCLUSIVE',
  'a source-level complete chapter sample never turns an incomplete lookup canonical');

// MangaDot's exact source HID is not verified edition identity. Only an
// explicit signed-code10 custom source diagnostic may inspect its chapters.
// Even a returned real-shaped chapter is not a canonical chapter grant.
{
  let chaptersRead = 0;
  let readerRequests = 0;
  const unverifiedDot = {
    ...candidate(base),
    externalWorkId: 'mangadot:109',
    authors: [],
    detailOutcome: undefined,
    coverageOutcome: undefined,
    coverageObservedCount: undefined,
  };
  const dotInput = {
    async lookup() {
      return { items: [unverifiedDot], nextCursor: 'incomplete-search' };
    },
    async chapters({ binding, cursor }) {
      chaptersRead++;
      assert.equal(binding.externalWorkId, 'mangadot:109');
      assert.equal(cursor, null);
      return {
        items: [{ providerChapterId: 'mangadot:uploads:1007',
          rawLabel: 'Ch. 1', rawNumber: 1, language: 'en' }],
        nextCursor: null,
      };
    },
    async pages() { readerRequests++; throw Error('Not permitted'); },
  };
  const noOptIn = await run(dotInput, base, {
    lookupPageLimit: 1, includeCandidateCoverage: true,
  });
  assert.equal(chaptersRead, 0);
  assert.equal(noOptIn.result.candidateChapterPreviews[0].outcome,
    'SOURCE_DETAIL_OR_COVERAGE_UNVERIFIED');
  const withOptIn = await run(dotInput, base, {
    lookupPageLimit: 1, includeCandidateCoverage: true,
    includeUnverifiedMangadotSourceDiagnostic: true,
    candidateChapterPageLimit: 2,
  });
  assert.equal(chaptersRead, 1);
  assert.equal(withOptIn.result.candidateChapterPreviews[0].authority,
    'SOURCE_UNVERIFIED_HID_DIAGNOSTIC_ONLY');
  assert.equal(withOptIn.result.candidateChapterPreviews[0].chapterCount, 1);
  assert.equal(withOptIn.result.candidateChapterPreviews[0].outcome, 'SOURCE_COMPLETE');
  assert.equal(withOptIn.result.lookupComplete, false);
  assert.equal(journeyVerdict(withOptIn.result), 'INCONCLUSIVE');
  assert.equal(readerRequests, 0);
  // The exception is only for the MangaDot numeric HID. A different source,
  // fake ID, unverified alias or positive source author evidence cannot use it.
  for (const invalid of [
    { ...unverifiedDot, externalWorkId: 'mangadex:abc' },
    { ...unverifiedDot, externalWorkId: 'mangafire:zk12' },
    { ...unverifiedDot, externalWorkId: 'mangadot:not-numeric' },
    { ...unverifiedDot, authors: ['Unverified Name'] },
    { ...unverifiedDot, coverageOutcome: 'EMPTY' },
  ]) {
    const value = await run({ ...dotInput, async lookup() {
      return { items: [invalid], nextCursor: 'still-incomplete' };
    }}, base, { lookupPageLimit: 1, includeCandidateCoverage: true,
      includeUnverifiedMangadotSourceDiagnostic: true });
    assert.equal(value.result.candidateChapterPreviews[0].outcome,
      'SOURCE_DETAIL_OR_COVERAGE_UNVERIFIED');
    assert.equal(journeyVerdict(value.result), 'INCONCLUSIVE');
  }
  assert.equal(chaptersRead, 1);
  assert.equal(readerRequests, 0);
}

// Coverage UNKNOWN is not zero chapters. Inspect actual source chapters
// read-only for a verified, author-bearing HID, even when discovery remains
// incomplete. This must NEVER grant pages or canonical/Reader authority.
const unknownCoverage = { ...candidate(base), coverageOutcome: 'UNKNOWN',
  coverageObservedCount: null, coverageHasMore: true };
test = await run({ async lookup() {
  return { items: [unknownCoverage], nextCursor: 'incomplete-source-search' };
}}, base, { lookupPageLimit: 1, includeCandidateCoverage: true,
  candidateChapterPageLimit: 2 });
assert.equal(test.result.lookupComplete, false);
assert.equal(test.result.candidateChapterPreviews.length, 1);
assert.equal(test.result.candidateChapterPreviews[0].chapterCount, 2);
assert.equal(test.result.candidateChapterPreviews[0].outcome, 'SOURCE_COMPLETE');
assert.equal(test.stats.chapters, 2);
assert.equal(test.stats.pages, 0);
assert.equal(journeyVerdict(test.result), 'INCONCLUSIVE',
  'unknown coverage may justify a bounded probe, never editorial binding');

// Large source inventory: a successful upstream response can still be too
// large for the Host's 64 KiB single-script result. Never grant Reader or
// canonical binding from a test-only preview of these items.
test = await run({
  async lookup() {
    return { items: [unknownCoverage], nextCursor: 'not-complete' };
  },
  async chapters() {
    return {
      items: Array.from({ length: 1628 }, (_, i) => ({
        ...chapter(base.work, i + 1),
        rawLabel: 'Chapter ' + (i + 1) + ' - a sufficiently long, nonidentifying synthetic label',
      })),
      nextCursor: null,
    };
  },
}, base, { lookupPageLimit: 1, includeCandidateCoverage: true,
  candidateChapterPageLimit: 2 });
assert.equal(test.result.candidateChapterPreviews[0].chapterCount, 1628);
assert.equal(test.result.candidateChapterPreviews[0].host64KChapterBody,
  'EXCEEDS_HOST_RESULT_CHAR_LIMIT');
assert.ok(test.result.candidateChapterPreviews[0].maxChapterResponseChars > 65536);
assert.ok(test.result.candidateChapterPreviews[0].maxChapterResponseUtf8Bytes > 65536);
assert.equal(test.stats.pages, 0);
assert.equal(journeyVerdict(test.result), 'INCONCLUSIVE');

// Missing source authors, unverified source detail or declared EMPTY coverage
// must remain closed, without network calls to the candidate chapter feed.
for (const blockedCandidate of [
  { ...unknownCoverage, authors: [] },
  { ...unknownCoverage, detailOutcome: 'DETAIL_FAILED' },
  { ...unknownCoverage, coverageOutcome: 'EMPTY' },
]) {
  test = await run({ async lookup() {
    return { items: [blockedCandidate], nextCursor: 'still-incomplete' };
  }}, base, { lookupPageLimit: 1, includeCandidateCoverage: true,
    candidateChapterPageLimit: 2 });
  assert.equal(test.result.candidateChapterPreviews[0].outcome,
    'SOURCE_DETAIL_OR_COVERAGE_UNVERIFIED');
  assert.equal(test.stats.chapters, 0);
  assert.equal(test.stats.pages, 0);
  assert.equal(journeyVerdict(test.result), 'INCONCLUSIVE');
}

test = await run({ async chapters() { return { items: [], nextCursor: null }; } });
assert.equal(test.result.chapters, 'COMPLETE_EMPTY');
assert.equal(test.result.pages, 'NO_CHAPTER_FOR_READER');
assert.equal(journeyVerdict(test.result), 'EMPTY_SOURCE_INVENTORY');

test = await run({ async chapters() {
  return { items: [chapter(base.work, 1)], nextCursor: 'repeated' };
}}, base, { chapterPageLimit: 3 });
assert.equal(test.result.chapters, 'INVALID_CONTRACT');
assert.equal(journeyVerdict(test.result), 'FAIL_CONTRACT');

test = await run({ async chapters({ cursor }) {
  return { items: [chapter(base.work, 1)], nextCursor: cursor ? null : 'next' };
}});
assert.equal(test.result.chapters, 'INVALID_CONTRACT', 'duplicates across pages must fail closed');

test = await run({ async chapters() {
  return { items: [{ ...chapter(base.work, 1), providerChapterId: 'mangadex:foreign-id' }],
    nextCursor: null };
}});
assert.equal(journeyVerdict(test.result), 'FAIL_CONTRACT');

test = await run({ async chapters() {
  return { items: [chapter(base.work, 2), chapter(base.work, 4)], nextCursor: null };
}, async pages() {} });
assert.equal(test.result.chapterOnePresent, false);
assert.equal(test.result.numberingGapObserved, true);
// An absent chapter #1 and numeric gaps are quality signals, not proof that
// the source's particular numbering scheme is invalid.

// The HTTP 403, missing edition or unverified title does not manufacture chapters.
test = await run({ async lookup() { throw Error('MangaFire challenge required'); } });
assert.equal(test.result.lookup, 'UPSTREAM_ERROR');
assert.equal(test.stats.chapters, 0);
assert.equal(journeyVerdict(test.result), 'INCONCLUSIVE');

test = await run({ async lookup() { return { items: [], nextCursor: null }; } });
assert.equal(test.result.lookup, 'NO_MATCH');
assert.equal(test.stats.chapters, 0);
assert.equal(journeyVerdict(test.result), 'INCONCLUSIVE');

test = await run({ async pages() {
  return { type: 'page_list', pages: [{ url: 'https://evil-mfcdn.cc/1.jpg' }] };
}});
assert.equal(test.result.pages, 'INVALID_CONTRACT');
assert.equal(journeyVerdict(test.result), 'FAIL_CONTRACT');
assert.equal(granted('https://img.mfcdn.cc/1.png', grants), true);
assert.equal(granted('https://evil-mfcdn.cc/1.png', grants), false);
assert.equal(granted('http://img.mfcdn.cc/1.png', grants), false);

// A54 regression: Blue Box (Oneshot) can share a title alias and author with
// the serialized Ao no Hako. Shared author/alias is NOT edition equivalence.
const ao = specFor(catalog.cases.find((x) => x.id === 'ao-no-hako'));
test = await run({ async lookup() {
  return { items: [
    { ...candidate(ao), authors: ['Kouji Miura'] },
    { ...candidate(ao), title: 'Blue Box (Oneshot)', aliases: ['Ao no Hako'],
      externalWorkId: 'mangafire:oneshot-fixture', authors: ['Kouji Miura'] },
  ], nextCursor: null };
} }, ao);
assert.equal(test.result.matchingWorkCount, 2);
assert.equal(test.result.sameSourceRivals, true);
assert.equal(test.result.sourceAuthorDisagreement, false);
assert.equal(journeyVerdict(test.result), 'AMBIGUOUS_EDITION');
assert.equal(test.stats.chapters, 0, 'same-author oneshot must not authorize edition');
assert.equal(test.stats.pages, 0);

// A54 regression: a publisher may credit writer and artist separately.
// Distinct author sets across two otherwise identical Akame candidates never
// justify promoting either source to an editorial binding automatically.
const akame = specFor(catalog.cases.find((x) => x.id === 'akame-ga-kill'));
test = await run({ async lookup() {
  return { items: [
    { ...candidate(akame), authors: ['Takahiro'] },
    { ...candidate(akame), externalWorkId: 'mangadex:11111111-2222-4333-8444-555555555555',
      authors: ['Tetsuya Tashiro'] },
  ], nextCursor: null };
} }, akame);
assert.equal(test.result.matchingWorkCount, 2);
assert.equal(test.result.sourceAuthorDisagreement, true);
assert.equal(journeyVerdict(test.result), 'AMBIGUOUS_EDITION');
assert.equal(test.stats.chapters, 0);
assert.equal(test.stats.pages, 0);

// Signed code10 canonical Host collection accepts at most eight lookup
// pages. A signed real HTTP capture must retain all eight request envelopes
// when its source still supplies a continuation after page three. An eighth
// pending cursor means INCOMPLETE, not a completed empty source.
const capped = { ...base, names: [base.names[0]] };
let capturedPages = 0;
const eightPage = await probeJourney({
  async lookup({ cursor, requestedLanguage, coverageEvidenceVersion,
                 editorialEvidenceVersion, diagnosticsVersion }) {
    assert.equal(requestedLanguage, 'en');
    assert.equal(coverageEvidenceVersion, 1);
    assert.equal(editorialEvidenceVersion, 1);
    assert.equal(diagnosticsVersion, 1);
    assert.equal(cursor, capturedPages === 0 ? null : 'cursor-' + capturedPages);
    capturedPages++;
    return { items: capturedPages === 1 ? [candidate(capped)] : [],
      nextCursor: 'cursor-' + capturedPages };
  },
  async chapters() { throw Error('No chapters may be claimed from incomplete lookup'); },
  async pages() { throw Error('Reader must not run after truncated lookup'); },
}, capped, grants, { lookupPageLimit: 8, lookupContract: 'v1' });
assert.equal(capturedPages, 8);
assert.equal(eightPage.lookupPages, 8);
assert.equal(eightPage.lookupComplete, false);
assert.equal(eightPage.chapters, 'NOT_TESTED');
assert.equal(eightPage.pages, 'NOT_TESTED');
assert.equal(eightPage.authority, 'SOURCE_METADATA_ONLY_NO_CANONICAL_OR_READER_PROOF');
await assert.rejects(
  probeJourney({ async lookup() { throw Error('unexpected'); } }, capped, grants,
    { lookupPageLimit: 9, lookupContract: 'v1' }),
  /Invalid bounded MangaAll journey limits/,
);

console.log('MangaAll FULL-JOURNEY OFFLINE PASS | curated=' + catalog.cases.length +
  ' | comics=' + comicCases + ' | prose-boundary=' + proseCases +
  ' | pagination/conflict/partial/missing/403/Reader-url: CHECKED | network=SYNTHETIC');
