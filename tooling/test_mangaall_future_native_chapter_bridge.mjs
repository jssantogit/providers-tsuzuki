import assert from 'node:assert/strict';
import {futureMangaDotChaptersViaNativeHost as chapters,
  FUTURE_NATIVE_BRIDGE_LIMITS as limits} from './mangaall_future_native_chapter_bridge.mjs';
import {expandMangaDotSourceRow as expand}
  from './mangaall_future_compact_source_chapter.mjs';

// The native boundary is deliberately simulated; no source HTTP is sent.
// Each call mimics a fresh QuickJs module invocation without JS state.
const WORK='mangadot:131',LANG='en',GEN='0123456789abcdef';
const input=(cursor=null,work=WORK,language=LANG)=>({
  binding:{externalWorkId:work,facetId:language},cursor,
});
const expected=Array.from({length:4341},(_,i)=>
  expand([String(13100001+i),i+1,0,'Ch '+(i+1),'en','Ju-Ni',null],LANG));
let starts=0,nexts=0;
const slice=(offset)=>{
  const items=expected.slice(offset,offset+240);
  const following=offset+items.length;
  const nextCursor=following<expected.length?
    'm1:131:en:'+GEN+':'+following:null;
  const json=JSON.stringify({items,nextCursor});
  assert.ok(json.length<=limits.maxResultBytes);
  assert.ok(Buffer.byteLength(json,'utf8')<=limits.maxResultBytes);
  return json;
};
const host={
  async start(work,lang) {
    assert.equal(work,WORK);assert.equal(lang,LANG);starts++;
    return slice(0);
  },
  async next(work,lang,cursor) {
    assert.equal(work,WORK);assert.equal(lang,LANG);nexts++;
    assert.match(cursor,/^m1:131:en:0123456789abcdef:[1-9][0-9]{0,4}$/);
    return slice(Number(cursor.slice(cursor.lastIndexOf(':')+1)));
  },
};
let cursor=null,pages=0;
const observed=[];
do {
  const page=await chapters(input(cursor),host);
  observed.push(...page.items.map(row=>row.providerChapterId));
  cursor=page.nextCursor;
  pages++;
  assert.ok(pages<=limits.maxHostPages);
} while(cursor!==null);
assert.deepEqual(observed,expected.map(row=>row.providerChapterId));
assert.equal(starts,1);
assert.equal(nexts,pages-1);
assert.ok(pages>=17&&pages<=32);
assert.equal(limits.authority,'NONSHIPPING_SOURCE_METADATA_ONLY');

const first=expected[0];
const wire=(items,continuation=null)=>JSON.stringify({items,nextCursor:continuation});
async function rejectsNative(raw,expectedFailure,requested=input()){
  const simulated={async start(){return raw;},async next(){return raw;}};
  await assert.rejects(chapters(requested,simulated),expectedFailure);
}
await rejectsNative('not-json',/MALFORMED_HOST_PAGE/);
await rejectsNative('{"items":[not-json],"nextCursor":null}',/MALFORMED_HOST_PAGE/);
await rejectsNative(JSON.stringify({items:[first],nextCursor:null,extra:1}),/MALFORMED_HOST_PAGE/);
await rejectsNative(wire([first,first]),/INVALID_SOURCE_CHAPTER/);
await rejectsNative(wire([{...first,extra:true}]),/INVALID_SOURCE_CHAPTER/);
await rejectsNative(wire([{...first,providerChapterId:'mangadex:foreign'}]),/INVALID_SOURCE_CHAPTER/);
await rejectsNative(wire([{...first,language:'pt-br'}]),/INVALID_SOURCE_CHAPTER/);
await rejectsNative(wire([{...first,releaseDateMillis:-1}]),/INVALID_SOURCE_CHAPTER/);
await rejectsNative(wire([{...first,rawNumber:Infinity}]),/INVALID_SOURCE_CHAPTER/);
await rejectsNative(wire([], 'm1:131:en:'+GEN+':1'),/NONMONOTONIC_HOST_CURSOR/);
await rejectsNative(wire([first],'m1:999:en:'+GEN+':1'),/FOREIGN_OR_INVALID_CURSOR/);
await rejectsNative(wire([first],'m1:131:en:'+GEN+':2'),/NONMONOTONIC_HOST_CURSOR/);
await rejectsNative(wire([first],'m1:131:en:aaaaaaaaaaaaaaaa:241'),
  /NONMONOTONIC_HOST_CURSOR/,input('m1:131:en:'+GEN+':240'));
await rejectsNative(wire([]),/EMPTY_CONTINUATION_NOT_VERIFIED/,
  input('m1:131:en:'+GEN+':240'));
await rejectsNative(wire([first]),/ROW_COUNT_LIMIT/,
  input('m1:131:en:'+GEN+':16000'));
await rejectsNative(wire(Array.from({length:257},()=>first)),/MALFORMED_HOST_PAGE/);
const unicode=wire(Array.from({length:10},(_,i)=>({
  ...expected[i],title:'界'.repeat(2100),rawLabel:'Ch. '+(i+1)+' '+'界'.repeat(2100),
})));
assert.ok(unicode.length<48*1024&&Buffer.byteLength(unicode,'utf8')>48*1024);
await rejectsNative(unicode,/HOST_OUTPUT_LIMIT/);
await rejectsNative('x'.repeat(48*1024+1),/HOST_OUTPUT_LIMIT/);

let called=0;
const forbidden={async start(){called++;return wire([]);},
  async next(){called++;return wire([]);}};
await assert.rejects(chapters(input(null,'mangadex:131'),forbidden),/INVALID_SOURCE_SCOPE/);
await assert.rejects(chapters(input(null,WORK,'fr'),forbidden),/INVALID_SOURCE_SCOPE/);
await assert.rejects(chapters(input('m1:131:pt-br:'+GEN+':2'),forbidden),
  /FOREIGN_OR_INVALID_CURSOR/);
await assert.rejects(chapters(input('m1:131:en:'+GEN+':0'),forbidden),
  /FOREIGN_OR_INVALID_CURSOR/);
await assert.rejects(chapters(input(),null),/NATIVE_BRIDGE_UNAVAILABLE/);
assert.equal(called,0,'invalid scopes must not invoke native services');

// An empty, genuinely successful first-page snapshot is distinguishable from
// a partial empty continuation (which is always rejected). Editorial authority
// remains outside this source adapter.
assert.deepEqual(await chapters(input(),forbidden),{items:[],nextCursor:null});
assert.equal(called,1);
console.log('MANGAALL_FUTURE_NATIVE_BRIDGE|4341_ROWS=RECONSTRUCTED|PAGES='+pages+
 '|NATIVE_START=1|CURSOR_AND_UTF8=FAIL_CLOSED|CANONICAL=NOT_GRANTED|CODE10=UNCHANGED');
