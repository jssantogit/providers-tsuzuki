import assert from 'node:assert/strict';
import { createFutureCachedChapterPager as create, FUTURE_SNAPSHOT_LIMITS as L }
  from './mangaall_future_storage_chapter_pager.mjs';

let now=1_783_000_000_000, generation=1;
const state=new Map(), stats={gets:0,sets:0,removes:0,remoteFetches:0};
const storage={
  async get(k){stats.gets++;return state.get(k)??null;},
  async set(k,v){
    if(!/^[a-zA-Z0-9._-]{1,128}$/.test(k)||typeof v!=='string'||v.length>65536)
      throw Error('HOST_STORAGE_VALUE_LIMIT');
    const copy=new Map(state);copy.set(k,v);
    if(copy.size>256||[...copy.values()].reduce((n,x)=>n+x.length,0)>512*1024)
      throw Error('HOST_STORAGE_TOTAL_LIMIT');
    state.set(k,v);stats.sets++;
  },
  async remove(k){stats.removes++;state.delete(k);},
};
const nonce=()=>String(generation++).padStart(16,'0');
const clock=()=>now;
function chapterRows(work,count=1628,padding=50){
  const local=Number(work.split(':')[1]);
  return Array.from({length:count},(_,i)=>({
    providerChapterId:'mangadot:chapters:'+(local*20000+i+1),
    rawLabel:'Ch. '+(i+1)+' — '+ 'Synthetic source data '.repeat(2)+'x'.repeat(padding),
    rawNumber:i+1,language:'en',title:null,scanlationGroup:'group',releaseDateMillis:null,
  }));
}
let planned=chapterRows('mangadot:109');
const wire=JSON.stringify({items:planned,nextCursor:null});
assert.ok(wire.length>65_536 && wire.length<440*1024,
  'Fixture models a real large source list which breaks a single Host result');
const fetchRows=async ({workId,language})=>{
  stats.remoteFetches++;
  assert.equal(language,'en');
  return {complete:true,sourceEvidence:'HTTP_200_NORMALIZED_VERIFIED',
    items:workId==='mangadot:109'?planned:chapterRows(workId,4,12)};
};
const dependencies={storage,fetchRows,now:clock,nonce};
let pager=create(dependencies);
let page=await pager.getPage({workId:'mangadot:109',language:'en'});
assert.equal(stats.remoteFetches,1);
assert.ok(page.items.length>0&&page.items.length<=128);
assert.ok(state.size>1);
let cursor=page.nextCursor, seen=page.items.map(x=>x.providerChapterId), pages=1;
const oldCursor=cursor;
while(cursor!=null){
  // New instance models Host's new QuickJs isolate on EVERY invocation.
  pager=create(dependencies);
  page=await pager.getPage({workId:'mangadot:109',language:'en',cursor});
  const encoded=JSON.stringify(page);
  assert.ok(encoded.length<=48*1024);
  assert.ok(Buffer.byteLength(encoded,'utf8')<=48*1024);
  assert.ok(page.items.length>0&&page.items.length<=128);
  seen.push(...page.items.map(x=>x.providerChapterId));
  cursor=page.nextCursor;
  pages++;
  assert.ok(pages<=32,'complete Naruto fixture must fit existing 32-page Host refresh');
}
assert.deepEqual(seen,planned.map(x=>x.providerChapterId));
assert.ok(pages>=13 && pages<=32);
assert.equal(stats.remoteFetches,1,'never re-fetch whole HTTP feed on each output page');
assert.ok(stats.gets < 400,'one source snapshot must not be reread for each individual chapter row');
assert.ok([...state.values()].reduce((n,x)=>n+x.length,0)<=512*1024);
assert.ok([...state.values()].every(v=>v.length<=64*1024));
assert.throws(()=>create({storage,fetchRows,now:clock}),/INVALID_FUTURE_PAGER_DEPENDENCY/);
await assert.rejects(()=>pager.getPage({workId:'mangadot:131',language:'en',cursor:oldCursor}),/STALE_OR_FOREIGN_CHAPTER_CURSOR/);
await assert.rejects(()=>pager.getPage({workId:'mangadot:109',language:'pt-br',cursor:oldCursor}),/STALE_OR_FOREIGN_CHAPTER_CURSOR/);
await assert.rejects(()=>pager.getPage({workId:'mangadot:109',language:'en',cursor:'p1:109:en:deadbeefdeadbeef:1'}),/STALE_OR_FOREIGN_CHAPTER_CURSOR/);
await assert.rejects(()=>pager.getPage({workId:'mangadot:109',language:'en',cursor:'p1:109:en:0000000000000001:99999'}),/CHAPTER_CURSOR_OUT_OF_BOUNDS/);
now+=L.snapshotTtlMs+1;
await assert.rejects(()=>pager.getPage({workId:'mangadot:109',language:'en',cursor:oldCursor}),/EXPIRED_CHAPTER_SNAPSHOT/);
now-=L.snapshotTtlMs+1;
// A new work evicts the previous active work; old cursors fail, never mix.
const alternate=await pager.getPage({workId:'mangadot:131',language:'en'});
assert.equal(alternate.items.length,4);
assert.equal(alternate.nextCursor,null);
await assert.rejects(()=>pager.getPage({workId:'mangadot:109',language:'en',cursor:oldCursor}),/STALE_OR_FOREIGN_CHAPTER_CURSOR/);
// Sequential 30-work rotation stays inside quota while maintaining distinct IDs.
for(let w=0;w<30;w++){
  const id='mangadot:'+(200+w);
  const result=await create(dependencies).getPage({workId:id,language:'en'});
  assert.equal(result.items.length,4);
  assert.equal(result.nextCursor,null);
  assert.ok([...state.values()].reduce((n,x)=>n+x.length,0)<=512*1024);
}
const remoteBefore=stats.remoteFetches;
const partial=create({storage,fetchRows:async()=>({complete:false,
  sourceEvidence:'HTTP_200_NORMALIZED_VERIFIED',items:[]}),now:clock,nonce});
await assert.rejects(()=>partial.getPage({workId:'mangadot:109',language:'en'}),
  /INCOMPLETE_OR_UNVERIFIED_SOURCE_INVENTORY/);
assert.equal(stats.remoteFetches,remoteBefore);
const unverified=create({storage,fetchRows:async()=>({complete:true,items:[]}),now:clock,nonce});
await assert.rejects(()=>unverified.getPage({workId:'mangadot:109',language:'en'}),
  /INCOMPLETE_OR_UNVERIFIED_SOURCE_INVENTORY/);
// Huge source cannot be silently truncated to a false full source snapshot.
const tooBig=create({storage,fetchRows:async()=>({complete:true,
 sourceEvidence:'HTTP_200_NORMALIZED_VERIFIED',items:chapterRows('mangadot:109',6000)}),
  now:clock,nonce});
await assert.rejects(()=>tooBig.getPage({workId:'mangadot:109',language:'en'}),
  /SNAPSHOT_EXCEEDS_PROVIDER_STORAGE_QUOTA/);
assert.ok([...state.values()].reduce((n,x)=>n+x.length,0)<=512*1024);
// A real-sized 4,341 Bleach portfolio cannot be silently squeezed into
// the Host's existing 512 KiB provider storage quota. This remains a known
// source-snapshot blocker, not a reason to discard rows or raise global caps.
const bleachOversize=create({storage,fetchRows:async()=>({complete:true,
  sourceEvidence:'HTTP_200_NORMALIZED_VERIFIED',items:chapterRows('mangadot:131',4341)}),
  now:clock,nonce});
await assert.rejects(()=>bleachOversize.getPage({workId:'mangadot:131',language:'en'}),
  /SNAPSHOT_EXCEEDS_PROVIDER_STORAGE_QUOTA/);
assert.ok([...state.values()].reduce((n,x)=>n+x.length,0)<=512*1024);
// Single invalid chapter ID and duplicates cannot enter the cache.
const invalid=create({storage,fetchRows:async()=>({complete:true,
  sourceEvidence:'HTTP_200_NORMALIZED_VERIFIED',
  items:[{...planned[0],providerChapterId:'mangadex:outside'}]}),
  now:clock,nonce});
await assert.rejects(()=>invalid.getPage({workId:'mangadot:109',language:'en'}),
  /INVALID_CHAPTER_EVIDENCE/);
const duplicate=create({storage,fetchRows:async()=>({complete:true,
  sourceEvidence:'HTTP_200_NORMALIZED_VERIFIED',items:[planned[0],planned[0]]}),
  now:clock,nonce});
await assert.rejects(()=>duplicate.getPage({workId:'mangadot:109',language:'en'}),
  /INVALID_CHAPTER_EVIDENCE/);
assert.equal(L.scope,'FUTURE_UNSHIPPED_STORAGE_PERMISSION_REQUIRED');
console.log('MANGAALL_FUTURE_STORAGE_PAGER|1628_ROWS=RECONSTRUCTED|PAGES='+pages+
 '|REMOTE_FETCHES_PER_WORK=1|30_WORK_ROTATION=PASS|HOST_STORAGE_512K=ENFORCED'+
 '|HOST_OUTPUT_48K=ENFORCED|CANONICAL=NOT_GRANTED|SIGNED_CODE10=UNCHANGED');
