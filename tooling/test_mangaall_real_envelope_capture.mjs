// Contract-only fixtures: this file NEVER claims that fake HTTP is real.
 // The production runner wraps the already-verified signed code8 reading JS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRealEnvelopeCapture } from './mangaall_real_envelope_capture.mjs';

const sha = 'f'.repeat(64);
const requests = [];
const actual = {
  async lookup(input) {
    requests.push(['lookup', input]);
    return { items: [{
      externalWorkId: 'mangafire:52020', title: 'Dungeon Meshi',
      aliases: ['Delicious in Dungeon'], authors: ['KUI Ryoko'],
      language: 'en', url: 'https://mangafire.to/title/52020-dungeon-meshi',
      detailOutcome: 'VERIFIED_WITH_ALIASES', coverageOutcome: 'OBSERVED',
      coverageObservedCount: 200, coverageMinMilli: 0,
      coverageMaxMilli: 74000, coverageHasMore: true,
    }], nextCursor: '{"v":1,"remaining":{"mangafire":{"c":"2"}}}' };
  },
  async chapters(input) {
    requests.push(['chapters', input]);
    return { items: [
      { providerChapterId: 'mangafire:chapter-100', rawLabel: 'Vol. 5 Ch. 25',
        rawNumber: 25, volume: 5, language: 'en',
        scanlationGroup: 'Official', releaseDateMillis: 1730500000000 },
    ], nextCursor: null };
  },
  async pages(input) {
    requests.push(['pages', input]);
    return { type: 'page_list', pages: [
      { url: 'https://secret-cdn.example.com/private?token=DO_NOT_EXPORT',
        headers: { Cookie: 'DO_NOT_EXPORT', Referer: 'https://mangafire.to' } },
    ] };
  },
};
const captured = createRealEnvelopeCapture(actual, {
  caseId: 'user-123', observedAt: '2026-11-16T09:00:00Z',
  providerCode: 8, packageSha256: sha,
});
const lookupInput = { titles: ['Dungeon Meshi'], requestedLanguage: 'en',
  diagnosticsVersion: 2, editorialEvidenceVersion: 1, coverageEvidenceVersion: 1 };
const binding = { providerId: 'app.tsuzuki.mangaall',
  facetId: 'en', externalWorkId: 'mangafire:52020' };
const chaptersInput = { binding, cursor: null };
const pagesInput = { binding, providerChapterId: 'mangafire:chapter-100' };
const first = await captured.reading.lookup(lookupInput);
assert.equal(first.items[0].authors[0], 'KUI Ryoko',
  'capturing never changes the live response used by the caller');
assert.deepEqual(await captured.reading.chapters(chaptersInput),
  await actual.chapters(chaptersInput));
await captured.reading.pages(pagesInput);
const result = captured.finalize();
assert.equal(result.captureKind, 'REAL_PROVIDER_NORMALIZED_ENVELOPES');
assert.equal(result.sourceNetworkStage, 'RECORDED_BY_LIVE_CALLER_NOT_VERIFIED_HERE');
assert.equal(result.canonicalStage, 'NOT_EXECUTED_HOST');
assert.equal(result.readerStage, 'PAGE_METADATA_ONLY_NOT_REPLAYABLE');
assert.equal(result.providerCode, 8);
assert.equal(result.records.length, 3);
assert.equal(result.records[0].operation, 'lookup');
assert.equal(result.records[0].request.requestedLanguage, 'en');
assert.equal(result.records[0].response.items[0].externalWorkId, 'mangafire:52020');
assert.equal(result.records[0].response.items[0].authors[0], 'KUI Ryoko');
assert.equal(result.records[0].response.items[0].url,
  'https://mangafire.to/title/52020-dungeon-meshi');
assert.equal(result.records[0].response.nextCursor, first.nextCursor);
assert.equal(result.records[1].response.items[0].rawNumber, 25);
assert.equal(result.records[1].response.items[0].volume, 5);
assert.equal(result.records[1].response.items[0].scanlationGroup, 'Official');
assert.equal(result.records[1].response.items[0].releaseDateMillis, 1730500000000);
assert.equal(result.replayCompleteness, 'LOOKUP_CHAPTERS_ONLY');
assert.equal(result.records[2].response.pageCount, 1);
assert.equal(result.records[2].replayability, 'READER_URLS_REDACTED');
const serialized = JSON.stringify(result);
for (const secret of ['DO_NOT_EXPORT', 'secret-cdn', 'Cookie', 'Referer']) {
  assert.equal(serialized.includes(secret), false, secret);
}
assert.equal(result.sha256, createHash('sha256')
  .update(JSON.stringify({ ...result, sha256: undefined })).digest('hex'));
assert.equal(result.replayCompleteness, 'LOOKUP_CHAPTERS_ONLY');

const unavailable = createRealEnvelopeCapture({
  async lookup() {
    return { items: [], nextCursor: null, lookupFailureCode: 'HTTP_ERROR', lookupHttpStatus: 403 };
  },
  async chapters() { throw new Error('Should not request chapters'); },
  async pages() { throw new Error('Should not request pages'); },
}, { caseId: 'user-404', observedAt: '2026-11-16T09:00:00Z', providerCode: 8, packageSha256: sha });
await unavailable.reading.lookup(lookupInput);
const failed = unavailable.finalize();
assert.equal(failed.records[0].outcome, 'SOURCE_FAILURE');
assert.equal(failed.records[0].response.lookupFailureCode, 'HTTP_ERROR');
assert.equal(failed.records[0].response.lookupHttpStatus, 403);
assert.notEqual(failed.records[0].outcome, 'COMPLETE_EMPTY');

const leak = createRealEnvelopeCapture({
  async lookup() {
    return { items: [{ externalWorkId: 'mangafire:52020',
      title: 'https://malicious.example/?secret=DO_NOT_EXPORT',
      authors: ['KUI Ryoko'] }], nextCursor: null };
  },
  async chapters() { return { items: [], nextCursor: null }; },
  async pages() { return { pages: [] }; },
}, { caseId: 'user-leak', observedAt: '2026-11-16T09:00:00Z', providerCode: 8, packageSha256: sha });
await leak.reading.lookup(lookupInput);
const invalid = leak.finalize();
assert.equal(invalid.replayCompleteness, 'INCOMPLETE_REJECTED_FIELDS');
assert.equal(JSON.stringify(invalid).includes('malicious.example'), false);
assert.equal(JSON.stringify(invalid).includes('DO_NOT_EXPORT'), false);

const bounded = createRealEnvelopeCapture(actual, {
  caseId: 'user-1', observedAt: '2026-11-16T09:00:00Z', providerCode: 8,
  packageSha256: sha, maxRecords: 1,
});
await bounded.reading.lookup(lookupInput);
await bounded.reading.chapters(chaptersInput);
assert.equal(bounded.finalize().replayCompleteness, 'INCOMPLETE_BUDGET_EXCEEDED');

console.log('MangaAll real envelope capture contract: PASS (no claims about live network/Host)');
