import assert from 'node:assert/strict';
import { describeMangaDotChapterListHttp as shape } from './mangaall_mangadot_chapter_http_shape.mjs';

const reply = (body, statusCode = 200) =>
  JSON.stringify({ statusCode, body: typeof body === 'string' ? body : JSON.stringify(body) });
assert.deepEqual(shape(reply([{ id: 123, chapter_number: '1' }])), {
  status: 200, bodyKind: 'ARRAY', collection: 'ROOT', count: 1,
  firstRowKind: 'OBJECT', idKind: 'NUMBER', numberKind: 'STRING',
  hasErrorField: false,
});
assert.deepEqual(shape(reply({ chapters: [{ id: '43', chapter_number: 2 }] })), {
  status: 200, bodyKind: 'OBJECT', collection: 'chapters', count: 1,
  firstRowKind: 'OBJECT', idKind: 'STRING', numberKind: 'NUMBER',
  hasErrorField: false,
});
for (const key of ['data', 'items', 'results', 'chapter_list', 'list']) {
  const detected = shape(reply({ [key]: [] }));
  assert.equal(detected.collection, key);
  assert.equal(detected.count, 0);
}
assert.equal(shape(reply({ data: { chapters: [] }, error: 'dont export' })).bodyKind, 'OBJECT');
assert.equal(shape(reply({ data: { chapters: [] }, error: 'dont export' })).collection, 'NONE');
assert.equal(shape(reply({ data: { chapters: [] }, error: 'dont export' })).hasErrorField, true);
assert.equal(shape(reply('<html>blocked</html>')).bodyKind, 'NON_JSON_MARKUP');
assert.equal(shape(reply('not json')).bodyKind, 'NON_JSON_OTHER');
assert.equal(shape(reply(null)).bodyKind, 'NULL');
assert.equal(shape(reply([1, 2, 3], 429)).status, 429);
assert.equal(shape('bad json').bodyKind, 'INVALID_ENVELOPE');
const injection = JSON.stringify({url:'https://private.example/?token=secret',body:'SUPER_SECRET',statusCode:200});
assert.ok(!JSON.stringify(shape(injection)).includes('secret'));
assert.ok(!JSON.stringify(shape(reply({ chapters: [{id:'secret',chapter_number:'secret'}] }))).includes('secret'));
assert.ok(Object.keys(shape(reply([]))).every(k => [
  'status','bodyKind','collection','count','firstRowKind','idKind','numberKind','hasErrorField',
].includes(k)));
console.log('MangaAll closed MangaDot chapter response shape summaries: PASS');
