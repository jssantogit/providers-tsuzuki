import assert from 'node:assert/strict';
import {inspectBoundedChapterArray as inspect, closedSourceFailure}
  from './mangaall_future_streaming_chapter_array.mjs';
const enc=new TextEncoder();
async function* fragments(text,bytesPerPart=8191) {
  const bytes=enc.encode(text);
  for(let offset=0;offset<bytes.length;offset+=bytesPerPart) {
    yield bytes.subarray(offset,Math.min(offset+bytesPerPart,bytes.length));
  }
}
const nested=JSON.stringify([
  {id:1,chapter_number:1,source:'user',chapter_title:'Brace } and escaped " quote'},
  {id:'2',chapter_number:'2.5',source:'scraper',groups:[{name:'Some group'}]},
  {id:1,chapter_number:'3',source:'user'},
]);
let out=await inspect(fragments(nested,5));
assert.equal(out.outcome,'COMPLETE_SOURCE_ARRAY_OBSERVED_METADATA_ONLY');
assert.equal(out.rowCount,3);
assert.equal(out.distinctNumericIds,2);
assert.equal(out.duplicateNumericIds,1);
assert.equal(out.numericChapterLabels,3);
assert.equal(out.userOrUnknownSourceRows,2);
assert.equal(out.otherSourceRows,1);
assert.equal(out.authority,'UNVERIFIED_SOURCE_HID_NO_CANONICAL_OR_READER');
assert.equal(out.decodedBytes,enc.encode(nested).length);
assert.ok(!JSON.stringify(out).includes('Some group'));
assert.ok(!JSON.stringify(out).includes('escaped'));
out=await inspect(fragments(' [] ',1));
assert.equal(out.rowCount,0); // parser result only, NOT canonical empty grant
const huge=JSON.stringify(Array.from({length:1800},(_,i)=>({
  id:i+1,chapter_number:i+1,source:'user',chapter_title:'x'.repeat(1300),
})));
assert.ok(enc.encode(huge).length>2*1024*1024);
out=await inspect(fragments(huge,4093));
assert.equal(out.rowCount,1800);
assert.equal(out.distinctNumericIds,1800);
assert.ok(out.decodedBytes>2*1024*1024);
assert.ok(out.maxRowChars<20000);
assert.ok(!('items' in out));
for(const raw of ['{}','[1]','[{"id":1},]','[{"id":1}','[{"id":1}] followed','[{"id":1}',null]) {
  if(raw==null) continue;
  await assert.rejects(()=>inspect(fragments(raw,3)),/INVALID_JSON_ARRAY_STREAM|INCOMPLETE_JSON_ARRAY_STREAM|INVALID_SOURCE_ROW/);
}
await assert.rejects(()=>inspect(fragments(huge,250),{maxDecodedBytes:100_000}),/SOURCE_STREAM_TOO_LARGE/);
await assert.rejects(()=>inspect(fragments(nested,5),{maxRows:2}),/SOURCE_TOO_MANY_ROWS/);
await assert.rejects(()=>inspect(fragments(nested,4),{maxRowChars:24}),/SOURCE_ROW_TOO_LARGE/);
await assert.rejects(()=>inspect(fragments(nested),{maxDecodedBytes:16*1024*1024+1}),/INVALID_JSON_ARRAY_STREAM/);
await assert.rejects(()=>inspect(fragments(nested),{maxRows:16001}),/INVALID_JSON_ARRAY_STREAM/);
assert.equal(closedSourceFailure(new Error('NETWORK: private?cookie=secret')),
  'SOURCE_TRANSPORT_OR_RUNTIME_FAILED');
assert.equal(closedSourceFailure(new Error('SOURCE_STREAM_TOO_LARGE')),'SOURCE_STREAM_TOO_LARGE');
console.log('MANGAALL_FUTURE_STREAM_ARRAY|realistic>2MiB=COMPLETE_1800_ROWS|memory=BOUNDED_PER_ROW|noRawData=PASS|partial=NEVER_EMPTY');
