import assert from 'node:assert/strict';
import { experimentalPageChapterOutput as page, EXPERIMENTAL_LIMITS as limits }
  from './mangaall_experimental_chapter_output_paging.mjs';

const makeRows = count => Array.from({length:count}, (_,i) => ({
  providerChapterId: 'mangadot:chapters:' + (i+1),
  rawLabel: 'Ch. ' + (i+1) + ' - ' + 'Synthetic untrusted source title '.repeat(5),
  rawNumber: i+1, language: 'en', scanlationGroup: 'Test group',
}));
const rows = makeRows(1628);
assert.equal(limits.hostProtocolMaxChars, 65536);
assert.equal(limits.authority, 'TOOLING_ONLY_NO_CANONICAL_OR_READER_GRANT');
const seen = [];
let cursor = null, pages = 0, secondPageCursor = null;
do {
  const p = page(rows, {workId:'mangadot:109',language:'en',cursor});
  if (pages === 0) secondPageCursor = p.nextCursor;
  const result = JSON.stringify(p);
  assert.ok(result.length <= limits.maxOutputUtf8Bytes);
  assert.ok(Buffer.byteLength(result, 'utf8') <= limits.maxOutputUtf8Bytes);
  assert.ok(p.items.length > 0 && p.items.length <= limits.maxPageItems);
  seen.push(...p.items.map(z=>z.providerChapterId));
  cursor = p.nextCursor;
  pages++;
  assert.ok(pages <= 32, 'Naruto-sized fixture must fit within Host 32-page refresh');
} while (cursor !== null);
assert.deepEqual(seen, rows.map(z=>z.providerChapterId));
assert.ok(pages >= 13 && pages <= 32);
assert.ok(secondPageCursor);
assert.throws(()=>page(rows,{workId:'mangadot:131',language:'en',cursor:secondPageCursor}),/UNTRUSTED_CHAPTER_CURSOR/);
assert.throws(()=>page(rows,{workId:'mangadot:109',language:'pt-br',cursor:secondPageCursor}),/INVALID_SOURCE_CHAPTER_OBSERVATION/);
assert.throws(()=>page(makeRows(2),{workId:'mangadot:109',language:'en',cursor:secondPageCursor}),/STALE_OR_OUT_OF_BOUNDS_CURSOR/);
assert.throws(()=>page([{...rows[0]}, {...rows[0]}],{workId:'mangadot:109',language:'en'}),/INVALID_SOURCE_CHAPTER_OBSERVATION/);
assert.throws(()=>page([{...rows[0],providerChapterId:'mangadex:foreign'}],{workId:'mangadot:109',language:'en'}),/INVALID_SOURCE_CHAPTER_OBSERVATION/);
assert.throws(()=>page([{...rows[0],rawLabel:'x'.repeat(4097)}],{workId:'mangadot:109',language:'en'}),/INVALID_SOURCE_CHAPTER_OBSERVATION/);
assert.throws(()=>page([...rows,{...rows[0],providerChapterId:'mangadot:uploads:9'}],{workId:'mangadot:invalid',language:'en'}),/INVALID_EXPERIMENTAL_CHAPTER_INPUT/);
assert.throws(()=>page(makeRows(16001),{workId:'mangadot:109',language:'en'}),/INVALID_EXPERIMENTAL_CHAPTER_INPUT/);
const longRow={...rows[0],title:'x'.repeat(60_000)};
assert.throws(()=>page([longRow],{workId:'mangadot:109',language:'en'}),/CHAPTER_ITEM_EXCEEDS_HOST_SAFE_BUDGET/);
// A huge source portfolio cannot be certified as complete within one 32-page
// refresh when no upstream cursor exists. Surface continuation, not empty.
const huge=makeRows(6000);
let next=null;
for(let i=0;i<32;i++){
  const p=page(huge,{workId:'mangadot:109',language:'en',cursor:next});
  assert.ok(p.items.length);
  next=p.nextCursor;
}
assert.ok(next !== null, 'Do not silently call 6,000 chapters a complete inventory after 32 pages');
console.log('MangaAll future unshipped chapter output pager: 1628 ordered items in '+pages+
  ' bounded pages; stale/foreign cursors rejected, huge inventory remains partial');
