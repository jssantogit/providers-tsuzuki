// Fully offline signed-source preflight. This test NEVER calls upstreams.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CODE9_SHA, CODE9_OPT_IN, checkSignedCode9SmokeSource,
  inspectCurrentSignedCode9Source, readSignedCode9ArchiveManifest,
} from './mangaall_signed_code9_smoke_gate.mjs';

const manifest = readSignedCode9ArchiveManifest();
const developmentManifest = JSON.parse(fs.readFileSync('providers/mangaall/manifest.json', 'utf8'));
assert.equal(manifest.version.code, 9, 'the trusted archived release remains code9');
assert.equal(developmentManifest.version.code, 10, 'future source is a separate unpublished candidate');
assert.ok(
  (developmentManifest.publication === 'development' && developmentManifest.version.name === '0.5.5-dev') ||
  (developmentManifest.publication === 'release' && developmentManifest.version.name === '0.5.5'),
  'code10 draft may stage a release manifest, but never replace the signed code9 archive',
);
assert.equal(fs.existsSync('review/mangaall-code10/approved-artifact.json'),
  developmentManifest.publication === 'release',
  'code10 release approval must not change the real signed code9 smoke source');
assert.throws(() => checkSignedCode9SmokeSource({
  manifest: developmentManifest,
  payload: JSON.parse(fs.readFileSync('dist/index.payload.json', 'utf8')),
  archiveBytes: fs.readFileSync('dist/providers/app.tsuzuki.mangaall-9.tsz'),
  consent: CODE9_OPT_IN,
}), 'an unshipped source manifest cannot attest the old signed ZIP');
const currentIndex = JSON.parse(fs.readFileSync('dist/index.payload.json', 'utf8'));
// Historical code9 verification remains structurally tested, but the CURRENT
// official P-256 root is now sequence36/code10. Never impersonate a signed
// code9 index by claiming the current sequence36 envelope is code9.
const nowCode10 = currentIndex.sequence === 36;
if (nowCode10) {
  const upgraded = currentIndex.providers.find(p => p.providerId === 'app.tsuzuki.mangaall');
  assert.equal(upgraded?.versionCode, 10);
  assert.equal(upgraded?.sha256,
    'bcdfd03ac18c3cfdd0517e08b58dde7efa1f5baa874e93002af28e518860f95f');
}
const payload = nowCode10 ? {
  ...currentIndex, sequence: 35,
  providers: currentIndex.providers.map(p => p.providerId === 'app.tsuzuki.mangaall'
    ? { ...p, versionName: '0.5.4', versionCode: 9, sha256: CODE9_SHA,
      artifactUrl: 'https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/main/dist/providers/app.tsuzuki.mangaall-9.tsz' }
    : p),
} : currentIndex; // Synthetic historical SHAPE only, NOT P-256 signed.
const archiveBytes = fs.readFileSync('dist/providers/app.tsuzuki.mangaall-9.tsz');
const run = (overrides = {}) => checkSignedCode9SmokeSource({
  manifest, payload, archiveBytes, consent: CODE9_OPT_IN, ...overrides,
});
const correct = run();
assert.equal(correct.providerCode, 9);
assert.equal(correct.sequence, 35);
assert.equal(correct.archiveSha256, CODE9_SHA);
assert.equal(correct.capture, 'V1_ONLY');
assert.equal(correct.canonicalBinding, false);
assert.equal(correct.readerPixels, false);
if (nowCode10) {
  // Current P-256 signature verifies sequence36 only; the historical
  // seq35 fixture above is STRUCTURAL, never presented as a signed index.
  assert.throws(() => inspectCurrentSignedCode9Source(CODE9_OPT_IN),
    /sequence35|sequence35 signature|sequence35 signature|35/);
} else {
  // Historical CI at sequence35 executed the real P-256 signature check.
  assert.deepEqual(inspectCurrentSignedCode9Source(CODE9_OPT_IN), correct);
}

for (const bad of [
  { consent: '' }, { consent: 'PUBLISH_MANGAALL_CODE9' },
  { consent: 'I_ACCEPT_LIVE_READ_ONLY' },
  { manifest: { ...manifest, version: { name: '0.5.3', code: 8 } } },
  { manifest: { ...manifest, publication: 'preview' } },
  { payload: { ...payload, sequence: 34 } },
  { payload: { ...payload, repositoryId: 'foreign.repo' } },
  { payload: { ...payload, providers: payload.providers.filter(x => x.providerId !== 'app.tsuzuki.mangaall') } },
  { payload: { ...payload, providers: [
    ...payload.providers,
    payload.providers.find(x => x.providerId === 'app.tsuzuki.mangaall'),
  ] } },
  { payload: { ...payload, providers: payload.providers.map(x =>
    x.providerId === 'app.tsuzuki.mangaall' ? { ...x, sha256: '0'.repeat(64) } : x) } },
  { archiveBytes: Buffer.from(archiveBytes.subarray(0, archiveBytes.length - 1)) },
]) {
  assert.throws(() => run(bad), undefined, JSON.stringify(Object.keys(bad)));
}
console.log('MANGAALL_CODE9_CANONICAL_V1_GATE|index=' +
  (nowCode10 ? 'HISTORICAL_STRUCTURAL_NOT_SIGNED_BY_CURRENT_SEQ36' : 'P256_SEQUENCE35') +
  '|archive=SHA_PINNED|http=NONE|canonical=DENIED|outcome=PASS');
