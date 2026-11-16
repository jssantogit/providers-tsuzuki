// Config parsing only. No fake source candidates or HTTP fixtures: the LIVE
// workflow receives arbitrary user-supplied works and fetches actual upstreams.
import assert from 'node:assert/strict';
import { parseWorks, shardWorks } from './mangaall_generic_works.mjs';

const input = [
  'Dungeon Meshi',
  'manga :: Enen no Shouboutai',
  'manhwa :: Tower of God',
  'webtoon :: Solo Leveling',
  'manhua :: The King's Avatar',
  'web_novel :: Shadow Slave',
  'light_novel :: Spice and Wolf',
].join('\n');
const cases = parseWorks(input);
assert.equal(cases.length, 7);
assert.equal(cases[0].format, 'unknown', 'a bare title does not establish a format');
assert.equal(cases[0].work, null, 'a title alone never verifies a specific source HID');
assert.deepEqual(cases[0].names, ['Dungeon Meshi']);
assert.equal(cases[0].probe, 'source_metadata');
assert.equal(cases[1].format, 'manga');
assert.equal(cases[6].format, 'light_novel');
assert.equal(cases[5].probe, 'discovery_only',
  'a stated prose format never borrows comic chapter or Reader authorization');
assert.equal(cases[6].probe, 'discovery_only');
assert.equal(new Set(cases.map(x => x.id)).size, cases.length);
assert.deepEqual(parseWorks(input).map(x => x.id), cases.map(x => x.id),
  'the case IDs are stable across runs, unrelated to a fixed title catalog');
assert.equal(JSON.stringify(cases).includes('knownWorkId'), false);

const shards = Array.from({ length: 3 }, (_, index) => shardWorks(cases, index, 3));
assert.deepEqual(shards.map(x => x.length), [3, 2, 2]);
assert.deepEqual(shards.flatMap(x => x.map(y => y.id)).sort(), cases.map(x => x.id).sort(),
  'every work appears in exactly one runner shard');
assert.deepEqual(shardWorks(cases, 0, 1), cases);
assert.deepEqual(shardWorks(cases, 2, 3).map(x => x.names[0]),
  ['manhwa :: invalid'].filter(() => false).concat(['Tower of God', 'Shadow Slave']));

assert.equal(parseWorks('Ｒｙōｋｏ\nOne Piece').length, 2,
  'non-ASCII manga and creator words are supported');
for (const invalid of [
  '', '   ', 'manga :: ', 'unknown_kind :: Dungeon Meshi',
  'Dungeon Meshi\nDungeon   Meshi',
  'MANGA :: Dungeon Meshi\nmanga :: dungeon meshi',
  'https://example.org/private?token=secret',
  'One Piece\tbad',
  'a'.repeat(181),
  Array.from({ length: 31 }, (_, n) => 'Work ' + n).join('\n'),
]) {
  assert.throws(() => parseWorks(invalid), undefined, invalid.slice(0, 40));
}
assert.throws(() => shardWorks(cases, -1, 3));
assert.throws(() => shardWorks(cases, 3, 3));
assert.throws(() => shardWorks(cases, 0, 0));
assert.throws(() => shardWorks(cases, 0, 9));

console.log('MangaAll arbitrary work selection: PASS (input contracts, format boundary, shards)');
