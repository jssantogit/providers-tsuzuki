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
assert.equal(comicCases, 52);

const base = specFor(catalog.cases.find((x) => x.id === 'punpun'));
const run = async (override, spec = base, options) => {
  const { reading, stats } = harness(spec, override);
  return { result: await probeJourney(reading, spec, grants, options), stats };
};

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
assert.equal(journeyVerdict(test.result), 'AMBIGUOUS_EDITION');
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
assert.equal(test.result.lookupPages, 2);
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

console.log('MangaAll FULL-JOURNEY OFFLINE PASS | curated=' + catalog.cases.length +
  ' | comics=' + comicCases + ' | prose-boundary=' + proseCases +
  ' | pagination/conflict/partial/missing/403/Reader-url: CHECKED | network=SYNTHETIC');
