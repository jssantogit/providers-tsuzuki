// Strict official signed 0.5.5/code10 THREE-source real-capture gate.
// Never grants canonical editorial truth, Reader pixels, or bypasses 403.
// Unlike a source/manifest version check, this verifies the authentic P-256
// index and SHA256 of the actual signed distribution archive before HTTP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const CODE10_SHA = 'bcdfd03ac18c3cfdd0517e08b58dde7efa1f5baa874e93002af28e518860f95f';
export const CODE10_OPT_IN = 'I_ACCEPT_SIGNED_CODE10_CANONICAL_SMOKE';

export function assertSignedCode10Smoke({manifest, payload, archiveBytes, approval, consent}) {
  assert.equal(consent, CODE10_OPT_IN, 'Code10 real canonical smoke requires explicit opt-in');
  assert.equal(manifest.id, 'app.tsuzuki.mangaall');
  assert.deepEqual(manifest.version, {name: '0.5.5', code: 10});
  assert.equal(manifest.publication, 'release');
  assert.equal(manifest.permissions?.storage?.enabled, false);
  assert.equal(payload.repositoryId, 'app.tsuzuki.providers');
  assert.equal(payload.sequence, 36, 'Requires REAL signed sequence36');
  const entries = payload.providers.filter(x => x.providerId === manifest.id);
  assert.equal(entries.length, 1, 'Exactly one MangaALL provider');
  assert.equal(entries[0].versionCode, 10);
  assert.equal(entries[0].versionName, '0.5.5');
  assert.equal(entries[0].sha256, CODE10_SHA);
  assert.equal(entries[0].minHostApi, 1);
  assert.equal(entries[0].artifactUrl,
    'https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/main/dist/providers/app.tsuzuki.mangaall-10.tsz');
  assert.equal(createHash('sha256').update(archiveBytes).digest('hex'), CODE10_SHA,
    'Host bytes differ from P-256 indexed archive');
  assert.deepEqual(approval, {
    reviewStatus: 'approved', versionCode: 10, versionName: '0.5.5',
    artifactSha256: CODE10_SHA, priorSequence: 35,
    priorCode9Sha256: 'd9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622',
  });
  for (const cap of ['reading.lookup', 'reading.chapters', 'reading.pages']) {
    assert.ok(manifest.capabilities.some(c => c.id === cap && c.version === 1));
  }
  return Object.freeze({indexSequence: 36, versionCode: 10,
    archiveSha256: CODE10_SHA, realSignedIndex: true,
    trustedAndroidInstallation: false, canonicalBinding: false, readerPixels: false});
}

export function inspectCurrentSignedCode10Source(consent) {
  const verified = spawnSync(process.execPath, ['tooling/verify_index.mjs'], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 512000,
  });
  if (verified.status !== 0 ||
      !verified.stdout.includes('signed repository index verified: app.tsuzuki.providers sequence 36')) {
    throw Error('Code10 source cannot verify actual P-256 signed sequence36 index');
  }
  return assertSignedCode10Smoke({
    manifest: JSON.parse(fs.readFileSync('providers/mangaall/manifest.json', 'utf8')),
    payload: JSON.parse(fs.readFileSync('dist/index.payload.json', 'utf8')),
    archiveBytes: fs.readFileSync('dist/providers/app.tsuzuki.mangaall-10.tsz'),
    approval: JSON.parse(fs.readFileSync('review/mangaall-code10/approved-artifact.json', 'utf8')),
    consent,
  });
}
