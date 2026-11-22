import assert from 'node:assert/strict';
import {projectMangaDotSourceRow as project, expandMangaDotSourceRow as expand,
  measureMangaDotCompactRow as measure} from './mangaall_future_compact_source_chapter.mjs';
import {chapters} from '../providers/mangaall/modules/sources/mangadot/modules/mangadot.js';
const rows=[
 {id:101,chapter_number:1,language:'en',source:'user',chapter_title:'Intro',
  groups:[{name:'Group Alpha'}],date_added:'2026-10-10T10:00:00Z'},
 {id:'102',chapter_number:'1.5',language:'EN',source:'scraper',
  scanlator_name:'Group Beta',chapter_title:'  Another chapter  '},
 {id:103,chapter_number:2,source:null,group_name:'Group Gamma'},
 {id:104,chapter_number:'3',language:'pt-br'},
 {id:'invalid',chapter_number:4},
 {id:105,chapter_number:'not a number'},
 {id:106,chapter_number:6,language:23},
];
globalThis.tsuzuki={http:{async request(method,url){
  assert.equal(method,'GET');
  assert.ok(url.startsWith('https://mangadot.net/api/manga/109/chapters/list?'));
  return JSON.stringify({statusCode:200,body:JSON.stringify(rows)});
}}};
const real=await chapters({binding:{externalWorkId:'mangadot:109',facetId:'en'},cursor:null});
const projected=rows.map(r=>project(r,'en')).filter(Boolean);
const restored=projected.map(p=>expand(p,'en'));
assert.deepEqual(restored,real.items,'tuple must round-trip the CURRENT source normalization exactly');
assert.equal(restored.length,3);
assert.equal(restored[0].providerChapterId,'mangadot:uploads:101');
assert.equal(restored[1].providerChapterId,'mangadot:chapters:102');
assert.equal(restored[1].rawLabel,'Ch. 1.5 Another chapter');
assert.equal(restored[2].language,null);
assert.ok(projected.every(p=>Array.isArray(p)&&p.length===7));
assert.ok(projected.every((p,i)=>measure(rows[i]).tupleChars <=measure(rows[i]).normalizedChars));
assert.throws(()=>expand(['109',1,9,null,null,null,null]),/INVALID_COMPACT_CHAPTER/);
assert.throws(()=>expand(['109',1,0,null,'pt-br',null,null]),/INVALID_COMPACT_CHAPTER/);
assert.throws(()=>expand(['0',1,0,null,null,null,null]),/INVALID_COMPACT_CHAPTER/);
assert.throws(()=>project({},'es'),/INVALID_COMPACT_FACET/);
const enc=JSON.stringify(projected);
assert.ok(!enc.includes('https://'));
assert.equal(project(rows[3],'en'),null);
assert.equal(project(rows[4],'en'),null);
assert.equal(project(rows[5],'en'),null);
console.log('MangaALL future compact chapter projection|LOSSLESS=SOURCE_ADAPTER_PARITY|authority=NONE');
