import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lookupTitleMatches } from '../providers/mangaall/modules/router.js';

const matrix = JSON.parse(fs.readFileSync('tooling/mangaall_case_matrix.json', 'utf8'));
assert.equal(matrix.schemaVersion, 1);
assert.equal(matrix.scope, 'hypotheses_and_two_device_observed_source_ids_not_catalog_ground_truth');
assert.ok(Array.isArray(matrix.cases));
assert.ok(matrix.cases.length >= 60);
const formats = new Set(['manga','manhwa','webtoon','manhua','light_novel','web_novel']);
const suites = new Set(['manga','manhwa','webtoon','manhua','prose']);
const probes = new Set(['source_metadata','discovery_only']);
const seen = new Set();
const titleFormat = new Set();
const totals = Object.fromEntries([...formats].map((format) => [format,0]));
let knownCount=0;
for (const item of matrix.cases) {
  assert.match(item.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(!seen.has(item.id), 'duplicate scenario id: ' + item.id);
  seen.add(item.id);
  assert.ok(formats.has(item.format),item.id);
  assert.ok(suites.has(item.suite),item.id);
  assert.ok(probes.has(item.probe),item.id);
  assert.equal(item.suite,['light_novel','web_novel'].includes(item.format)?'prose':item.format,item.id);
  assert.ok(typeof item.title === 'string' && item.title.length > 1 && item.title.length <= 160,item.id);
  assert.ok(Array.isArray(item.aliases) && item.aliases.every(s=>typeof s==='string'&&s.length>1&&s.length<=160),item.id);
  assert.ok(Array.isArray(item.tags) && item.tags.length && item.tags.every(s=>/^[a-z_]+$/.test(s)),item.id);
  assert.ok(!item.aliases.includes(item.title),item.id);
  assert.ok(['device_source_id','hypothesis'].includes(item.evidenceLevel),item.id);
  const key=item.format+':'+item.title.toLowerCase();
  assert.ok(!titleFormat.has(key),'duplicate edition/format case '+key);
  titleFormat.add(key);
  if (item.knownWorkId !== undefined) {
    knownCount++;
    assert.equal(item.evidenceLevel,'device_source_id');
    assert.equal(item.probe,'source_metadata');
    assert.match(item.knownWorkId,/^mangafire:[a-z0-9]{2,64}$/);
    assert.equal(item.format,'manga','do not invent confirmed non-manga source IDs');
  } else {
    assert.equal(item.evidenceLevel,'hypothesis');
    assert.equal(item.probe,'discovery_only');
  }
  // Prose discovery is a deliberate boundary: never suggest that chapter/page
  // metadata from a COMIC adapter authorizes reading a light or web novel.
  if (['light_novel','web_novel'].includes(item.format)) {
    assert.equal(item.probe,'discovery_only',item.id);
    assert.ok(item.tags.includes('format_boundary')||item.tags.includes('prose_vs_comic'),item.id);
  }
  totals[item.format]++;
}
assert.deepEqual(totals,{
  manga:27,manhwa:8,webtoon:10,manhua:7,light_novel:7,web_novel:6,
});
assert.equal(knownCount,2);
// Every scenario is addressable by the manual, bounded CI suite+batch selector.
// Never leave untested tail entries hidden behind a permanent .slice(0,4).
const selected = new Set(matrix.cases.filter(item=>item.probe==='source_metadata').map(item=>item.id));
for(const suite of suites) {
  const items = matrix.cases.filter(item=>item.suite===suite&&item.probe==='discovery_only');
  for(let batch=1;batch<=7;batch++) {
    for(const item of items.slice((batch-1)*4,batch*4)) {
      assert.ok(!selected.has(item.id),'duplicate live scenario '+item.id);
      selected.add(item.id);
    }
  }
}
assert.equal(selected.size,matrix.cases.length,'CI live sampling must cover every indexed case');
assert.equal(matrix.cases.find(x=>x.id==='punpun').knownWorkId,'mangafire:zk12');
assert.equal(matrix.cases.find(x=>x.id==='koe').knownWorkId,'mangafire:7p56');
assert.ok(matrix.cases.some(x=>x.id==='omniscient-reader-webtoon'));
assert.ok(matrix.cases.some(x=>x.id==='omniscient-reader-wn'));
assert.ok(matrix.cases.some(x=>x.id==='solo-leveling'));
assert.ok(matrix.cases.some(x=>x.id==='solo-leveling-wn'));
for(const [query,title,expected] of [
  ['Monster','Monster X Monster',false],
  ['Monster','MONSTER (Perfect Edition)',true],
  ['Dragon Ball','Dragon Ball Super',false],
  ['One Piece','One Piece: Ace’s Story',false],
  ['Solo Leveling','Solo Leveling',true],
  ['Vagabond','Patati Patata',false],
  ['Oyasumi Punpun','Goodnight Punpun',false],
]) {
  assert.equal(lookupTitleMatches([query],{title,aliases:[]}),expected,query+' vs '+title);
}
assert.equal(lookupTitleMatches(['Oyasumi Punpun'],{title:'Goodnight Punpun',aliases:['Oyasumi Punpun']}),true);
assert.equal(lookupTitleMatches(['Koe no Katachi'],{title:'A Silent Voice',aliases:['Koe no Katachi']}),true);
console.log('MangaAll arsenal OFFLINE PASS: '+matrix.cases.length+
  ' cases, '+knownCount+' observed source HIDs, formats='+JSON.stringify(totals)+
  ', no novel Reader assertion.');
