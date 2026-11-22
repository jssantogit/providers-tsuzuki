// One-shot, exact two-source chapter metadata capability check; nonshipping.
// Original signed code10 unchanged. No auth/cookies/CDN, no chapter ID, title,
// raw URL, HTTP header or body is ever written into a report.
import fs from 'node:fs';
import { inspectBoundedChapterArray, closedSourceFailure }
  from './mangaall_future_streaming_chapter_array.mjs';
const origin='https://mangadot.net';
const checks=[
  {label:'NARUTO_SOURCE_HID_109_UNVERIFIED',id:109},
  {label:'BLEACH_SOURCE_HID_131_UNVERIFIED',id:131},
];
const results=[];
for(const item of checks) {
  let response;
  let observation={source:item.label,outcome:'NOT_STARTED',status:null,
    authority:'UNVERIFIED_SOURCE_HID_NO_CANONICAL_OR_READER'};
  try {
    response=await fetch(origin+'/api/manga/'+item.id+'/chapters/list?lang=en',{
      method:'GET',redirect:'manual',
      headers:{
        Accept:'application/json',
        Origin:origin,
        Referer:origin+'/',
        'User-Agent':'Tsuzuki-MangaAll/0.1 (+https://github.com/jssantogit/providers-tsuzuki)',
      },signal:AbortSignal.timeout(25000),
    });
    observation.status=response.status;
    if(response.status!==200) {
      observation.outcome=response.status===403?'SOURCE_HTTP_403':
        response.status===429?'SOURCE_HTTP_429':'SOURCE_HTTP_NOT_200';
    } else if(!response.body) observation.outcome='SOURCE_STREAM_MISSING';
    else {
      const length=response.headers.get('content-length');
      if(length!==null && /^[0-9]+$/.test(length) &&
          Number(length)>16*1024*1024) {
        observation.outcome='SOURCE_STREAM_TOO_LARGE';
      } else {
        const summary=await inspectBoundedChapterArray(response.body);
        observation={source:item.label,status:response.status,...summary};
      }
    }
  } catch(error) {
    observation.outcome=closedSourceFailure(error);
  } finally {
    try { await response?.body?.cancel(); } catch {}
  }
  const keys=new Set(['source','status','outcome','authority','rowCount',
    'distinctNumericIds','duplicateNumericIds','numericChapterLabels',
    'maxRowChars','userOrUnknownSourceRows','otherSourceRows','decodedBytes']);
  if(Object.keys(observation).some(k=>!keys.has(k))) throw Error('UNEXPECTED_DIAGNOSTIC_KEY');
  results.push(observation);
  console.log('MANGAALL_STREAMING_CHAPTER_SHAPE|'+JSON.stringify(observation));
}
const report={
  schema:1,scope:'ONLY_TWO_FIXED_SOURCE_HIDS_NO_CANONICAL_READER_OR_CDN',
  signedCode10:'UNCHANGED',limitDecodedBytesPerSource:16*1024*1024,
  results,
};
fs.writeFileSync('mangaall-streaming-chapter-probe.json',
  JSON.stringify(report,null,2)+'\n');
