// 30-work readiness is an OFFLINE budget/selection contract. It does not
// invent titles, source candidates, chapter IDs, provider permissions or
// claims about remote HTTP/CDN availability.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseWorks, shardWorks } from './mangaall_generic_works.mjs';
import { THIRTY_WORK_CAPACITY, sourceRequestBudget, capacity30Plan }
  from './mangaall_30_capacity.mjs';

const names = Array.from({ length: 30 }, (_, i) =>
  'manga :: Synthetic Readiness Title ' + String(i+1).padStart(2,'0'));
const works = parseWorks(names.join('\n'));
const gate = capacity30Plan(works, 3);
assert.equal(works.length, 30);
assert.equal(new Set(works.map(w => w.id)).size, 30);
assert.deepEqual(gate.shardSizes, [10, 10, 10]);
assert.equal(gate.maxWorksPerShard, 10);
assert.equal(gate.scope, 'OFFLINE_CAPACITY_ONLY_NO_SOURCE_OR_CANONICAL_EVIDENCE');
assert.deepEqual(gate.maxSourceCallsPerShard, Array.from({length:3}, ()=>({
  MANGADEX: 320, MANGADOT: 320, MANGAFIRE: 80,
})));
const observed = [];
for(let shard=0;shard<3;shard++){
  const batch=shardWorks(works,shard,3);
  assert.equal(batch.length, 10);
  const plan=spawnSync(process.execPath,
    ['tooling/mangaall_live_matrix.mjs','--plan'],{
      encoding:'utf8',timeout:10000,
      env:{...process.env,MANGAALL_SUITE:'custom',MANGAALL_BATCH:'1',
        MANGAALL_WORKS:names.join('\n'),MANGAALL_SHARD_INDEX:String(shard),
        MANGAALL_SHARD_COUNT:'3'},
  });
  assert.equal(plan.status,0,plan.stderr);
  const parsed=JSON.parse(plan.stdout);
  assert.equal(parsed.inputCaseCount,30);
  assert.equal(parsed.selectedCaseCount,10);
  assert.equal(parsed.authority,'NO_SOURCE_OR_CANONICAL_EVIDENCE_COLLECTED');
  assert.deepEqual(parsed.capacity.shardSizes,[10,10,10]);
  assert.ok(parsed.cases.every(x=>x.sourceWorkId===null),
    'Input titles do not imply verified source HIDs');
  assert.deepEqual(parsed.cases.map(x=>x.title),batch.map(x=>x.names[0]));
  observed.push(...parsed.cases.map(x=>x.id));
}
assert.deepEqual(observed.sort(),works.map(w=>w.id).sort(),
  'Every work is visited exactly once across three shards');
assert.equal(sourceRequestBudget('MANGADEX',0,true),120);
assert.equal(sourceRequestBudget('MANGADEX',10,true),320);
assert.equal(sourceRequestBudget('MANGADOT',10,true),320);
assert.equal(sourceRequestBudget('MANGAFIRE',10,true),80);
assert.equal(sourceRequestBudget('MANGAFIRE',0,true),20);
assert.equal(sourceRequestBudget('MANGADEX',2,false),40);
assert.equal(sourceRequestBudget('MANGAFIRE',2,false),20);
assert.throws(()=>sourceRequestBudget('MANGADEX',31,true));
assert.throws(()=>sourceRequestBudget('MANGADEX',-1,true));
assert.throws(()=>sourceRequestBudget('unknown',10,true));
assert.throws(()=>capacity30Plan(works,2),/three bounded shards/);
assert.throws(()=>capacity30Plan(works,4),/three bounded shards/);
assert.throws(()=>capacity30Plan([...works,works[0]],3));
for(const count of [1,2,4]) {
  if(count===1 || count===2 || count===4){
    const plan=spawnSync(process.execPath,
      ['tooling/mangaall_live_matrix.mjs','--plan'], {
        encoding:'utf8',timeout:10000,
        env:{...process.env,MANGAALL_SUITE:'custom',MANGAALL_BATCH:'1',
          MANGAALL_WORKS:names.join('\n'),MANGAALL_SHARD_INDEX:'0',
          MANGAALL_SHARD_COUNT:String(count)},
      });
    assert.notEqual(plan.status,0,'30-work invalid sharding must fail before source calls');
  }
}
assert.ok(gate.limitations.includes('REAL_UPSTREAM_429_403_AND_2MIB_LISTS_MAY_STILL_FAIL'));
assert.ok(gate.limitations.includes('HOST_RUNTIME_64K_RESULTS_REMAIN_ENFORCED'));
console.log('MANGAALL_30_CAPACITY|scope=OFFLINE|works=30|shards=3|each=10|totalUnique=30|sourceCalls=HARD_CAPPED|canonical=NOT_AUTHORIZED|cdn=NOT_TESTED|status=PASS');
