// NONSHIPPING future code11 adapter prototype. NEVER imported by signed code10.
// The only chapter authority here is the exact native Host snapshot scope;
// this wrapper does not grant canonical work/edition or Reader permissions.
const WORK=/^mangadot:([1-9][0-9]{0,15})$/;
const CHAPTER=/^mangadot:(?:uploads|chapters):[1-9][0-9]{0,15}$/;
const CURSOR=/^m1:([1-9][0-9]{0,15}):(en|pt-br):([a-f0-9]{16}):([1-9][0-9]{0,4})$/;
const FIELDS=['providerChapterId','rawLabel','rawNumber','title','language',
  'scanlationGroup','releaseDateMillis'];
const MAX_ROWS=16000,MAX_PAGE_ROWS=256,MAX_WIRE=48*1024;
const fail=reason=>{throw Error('FUTURE_MANGAALL_'+reason);};
const exactFields=(obj,keys)=>Object.keys(obj).length===keys.length &&
  keys.every(key=>Object.hasOwn(obj,key));
const millis=value=>value===null||(Number.isSafeInteger(value)&&value>=0);

export const FUTURE_NATIVE_BRIDGE_LIMITS=Object.freeze({
  maxRows:MAX_ROWS,maxPageRows:MAX_PAGE_ROWS,maxResultBytes:MAX_WIRE,
  maxHostPages:32,authority:'NONSHIPPING_SOURCE_METADATA_ONLY',
});

function parseCursor(value,sourceId,language) {
  const match=typeof value==='string'?CURSOR.exec(value):null;
  if(!match||match[1]!==sourceId||match[2]!==language) {
    fail('FOREIGN_OR_INVALID_CURSOR');
  }
  const offset=Number(match[4]);
  if(offset<1||offset>MAX_ROWS) fail('CURSOR_OUT_OF_BOUNDS');
  return {generation:match[3],offset};
}

function parseNativePage(raw,sourceId,language,inputCursor) {
  if(typeof raw!=='string'||raw.length>MAX_WIRE ||
      Buffer.byteLength(raw,'utf8')>MAX_WIRE) fail('HOST_OUTPUT_LIMIT');
  let page;
  try {page=JSON.parse(raw);} catch {fail('MALFORMED_HOST_PAGE');}
  if(!page||typeof page!=='object'||Array.isArray(page)||
      !exactFields(page,['items','nextCursor'])||
      !Array.isArray(page.items)||page.items.length>MAX_PAGE_ROWS) {
    fail('MALFORMED_HOST_PAGE');
  }
  const seen=new Set();
  for(const row of page.items) {
    if(!row||typeof row!=='object'||Array.isArray(row)||
       !exactFields(row,FIELDS)||
       typeof row.providerChapterId!=='string'||
       !CHAPTER.test(row.providerChapterId)||
       seen.has(row.providerChapterId)||
       typeof row.rawLabel!=='string'||row.rawLabel.length>4096||
       typeof row.rawNumber!=='number'||!Number.isFinite(row.rawNumber)||
       row.rawNumber<0||
       (row.title!==null&&(typeof row.title!=='string'||row.title.length>3900))||
       (row.language!==null&&row.language!==language)||
       (row.scanlationGroup!==null&&
         (typeof row.scanlationGroup!=='string'||row.scanlationGroup.length>1024))||
       !millis(row.releaseDateMillis)) {
      fail('INVALID_SOURCE_CHAPTER');
    }
    seen.add(row.providerChapterId);
  }
  const prior=inputCursor===null?null:parseCursor(inputCursor,sourceId,language);
  const startingAt=prior?.offset??0;
  if(startingAt+page.items.length>MAX_ROWS) fail('ROW_COUNT_LIMIT');
  if(page.nextCursor!==null) {
    const next=parseCursor(page.nextCursor,sourceId,language);
    if(page.items.length===0||next.offset!==startingAt+page.items.length||
       (prior!==null&&next.generation!==prior.generation)) {
      fail('NONMONOTONIC_HOST_CURSOR');
    }
  } else if(page.items.length===0&&prior!==null) {
    fail('EMPTY_CONTINUATION_NOT_VERIFIED');
  }
  return page;
}

/**
 * Adapt the reviewed future Host's native start/next JSON envelope to the
 * unchanged V1 reading.chapters output shape. Native Host independently
 * verifies the cursor generation and the exact source/facet. It never accepts
 * a chapter URL or provider-selected origin.
 *
 * This tool is deliberately NOT a production Provider module. All bridge
 * wiring, manifest grants, source identity checks and code11 signing remain
 * separately reviewed future work.
 */
export async function futureMangaDotChaptersViaNativeHost(input,host) {
  const workId=input?.binding?.externalWorkId;
  const match=typeof workId==='string'?WORK.exec(workId):null;
  const language=input?.binding?.facetId??'en';
  if(!match||!['en','pt-br'].includes(language)) fail('INVALID_SOURCE_SCOPE');
  if(!host||typeof host.start!=='function'||typeof host.next!=='function') {
    fail('NATIVE_BRIDGE_UNAVAILABLE');
  }
  const requestedCursor=input?.cursor??null;
  if(requestedCursor!==null) parseCursor(requestedCursor,match[1],language);
  const raw=requestedCursor===null?
    await host.start(workId,language):
    await host.next(workId,language,requestedCursor);
  return parseNativePage(raw,match[1],language,requestedCursor);
}
