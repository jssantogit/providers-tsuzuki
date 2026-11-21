// P-256 verified official 0.5.5/code10 smoke provenance, FULLY OFFLINE.
// Code9 historic tests are structural only once sequence36 is public;
// this current-version gate actually invokes verify_index.mjs on seq36.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CODE10_SHA,CODE10_OPT_IN,assertSignedCode10Smoke,inspectCurrentSignedCode10Source}
  from './mangaall_signed_code10_smoke_gate.mjs';

const manifest = JSON.parse(fs.readFileSync('providers/mangaall/manifest.json', 'utf8'));
const payload = JSON.parse(fs.readFileSync('dist/index.payload.json', 'utf8'));
const archiveBytes = fs.readFileSync('dist/providers/app.tsuzuki.mangaall-10.tsz');
const approval = JSON.parse(fs.readFileSync('review/mangaall-code10/approved-artifact.json','utf8'));
const sample = {manifest,payload,archiveBytes,approval,consent:CODE10_OPT_IN};
const positive = assertSignedCode10Smoke(sample);
assert.equal(positive.indexSequence,36);
assert.equal(positive.archiveSha256,CODE10_SHA);
assert.equal(positive.trustedAndroidInstallation,false);
assert.equal(positive.canonicalBinding,false);
assert.equal(positive.readerPixels,false);
assert.deepEqual(inspectCurrentSignedCode10Source(CODE10_OPT_IN),positive,
  'actual signed P-256 seq36 index (not just synthetic fields) must verify');

for (const overridden of [
  {consent:''},{consent:'PUBLISH_MANGAALL_CODE10'},
  {consent:'I_ACCEPT_SIGNED_CODE9_CANONICAL_SMOKE'},
  {manifest:{...manifest,publication:'development'}},
  {manifest:{...manifest,version:{name:'0.5.5-dev',code:10}}},
  {manifest:{...manifest,version:{name:'0.5.4',code:9}}},
  {payload:{...payload,sequence:35}},
  {payload:{...payload,repositoryId:'untrusted.repo'}},
  {payload:{...payload,providers:payload.providers.filter(p=>p.providerId!=='app.tsuzuki.mangaall')}},
  {payload:{...payload,providers:payload.providers.map(p=>p.providerId==='app.tsuzuki.mangaall'?{...p,sha256:'0'.repeat(64)}:p)}},
  {archiveBytes:archiveBytes.subarray(0,archiveBytes.length-1)},
  {approval:{...approval,artifactSha256:'0'.repeat(64)}},
]) assert.throws(()=>assertSignedCode10Smoke({...sample,...overridden}),undefined,
  'must reject untrusted source: '+Object.keys(overridden).join(','));
console.log('MANGAALL_CODE10_SIGNED_SMOKE_GATE|P256=SEQUENCE36|SHA=VERIFIED|UPSTREAM=NONE|CANONICAL=DENIED|PASS');
