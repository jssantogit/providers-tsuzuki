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
assert.equal(fs.existsSync('review/mangaall-code10/approved-artifact.json'), false,
  'unsigned promotion PR cannot contain a code10 signing approval lock');
assert.throws(() => checkSignedCode9SmokeSource({
  manifest: developmentManifest,
  payload: JSON.parse(fs.readFileSync('dist/index.payload.json', 'utf8')),
  archiveBytes: fs.readFileSync('dist/providers/app.tsuzuki.mangaall-9.tsz'),
  consent: CODE9_OPT_IN,
}), 'an unshipped source manifest cannot attest the old signed ZIP');
const payload = JSON.parse(fs.readFileSync('dist/index.payload.json', 'utf8'));
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
// This executes the actual P-256 signature verifier, not a mock.
assert.deepEqual(inspectCurrentSignedCode9Source(CODE9_OPT_IN), correct);

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
console.log('MANGAALL_CODE9_CANONICAL_V1_GATE|index=P256_SEQUENCE35|archive=SHA_PINNED|http=NONE|canonical=DENIED|outcome=PASS');
