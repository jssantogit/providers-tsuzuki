// Gate signed code9 V1 real-source captures before canonical/SQLite smoke.
// Never infers editorial identity or Reader authority from a signed archive.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export const CODE9_SHA = 'd9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622';
export const CODE9_OPT_IN = 'I_ACCEPT_SIGNED_CODE9_CANONICAL_SMOKE';
export const CODE9_REPOSITORY = 'app.tsuzuki.providers';
export const CODE9_PROVIDER = 'app.tsuzuki.mangaall';

export function checkSignedCode9SmokeSource({
  manifest,
  payload,
  archiveBytes,
  consent,
}) {
  assert.equal(consent, CODE9_OPT_IN, 'Code9 canonical smoke requires explicit opt-in');
  assert.equal(manifest.id, CODE9_PROVIDER);
  assert.deepEqual(manifest.version, { name: '0.5.4', code: 9 });
  // The immutable signed runtime ZIP strips the source-only 'publication'
  // control. Its P-256 index entry and exact archive hash attest publication.
  assert.ok(manifest.publication === undefined || manifest.publication === 'release');
  assert.equal(payload.repositoryId, CODE9_REPOSITORY);
  assert.equal(payload.sequence, 35, 'First signed code9 smoke is pinned to sequence35');
  const mangaall = payload.providers.filter(p => p.providerId === CODE9_PROVIDER);
  assert.equal(mangaall.length, 1, 'Only one unified MangaAll may appear in index');
  assert.equal(mangaall[0].versionName, '0.5.4');
  assert.equal(mangaall[0].versionCode, 9);
  assert.equal(mangaall[0].sha256, CODE9_SHA);
  assert.equal(mangaall[0].minHostApi, 1);
  assert.equal(
    mangaall[0].artifactUrl,
    'https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/main/dist/providers/app.tsuzuki.mangaall-9.tsz',
  );
  const actual = createHash('sha256').update(archiveBytes).digest('hex');
  assert.equal(actual, CODE9_SHA, 'Signed archive hash differs from immutable reviewed code9');
  assert.ok(manifest.capabilities.some(c => c.id === 'reading.lookup' && c.version === 1));
  assert.ok(manifest.capabilities.some(c => c.id === 'reading.chapters' && c.version === 1));
  assert.ok(manifest.capabilities.some(c => c.id === 'reading.pages' && c.version === 1));
  return Object.freeze({
    repositoryId: CODE9_REPOSITORY, sequence: 35,
    providerCode: 9, archiveSha256: CODE9_SHA, capture: 'V1_ONLY',
    provenance: 'VERIFIED_SOURCE_ARCHIVE_NOT_AN_INSTALLED_ANDROID_LEDGER',
    canonicalBinding: false, readerPixels: false,
  });
}

// The signed-index verifier must run, not just compare an attacker-supplied
// SHA to an attacker-supplied JSON file. Never do upstream HTTP on failure.
export function verifyRealSignedIndexBeforeNetwork() {
  const result = spawnSync(process.execPath, ['tooling/verify_index.mjs'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 512_000,
  });
  if (result.status !== 0 || !result.stdout.includes('signed repository index verified: app.tsuzuki.providers sequence 35')) {
    throw Error('MangaAll code9 smoke cannot verify original P-256 sequence35 signature');
  }
}

/**
 * The CURRENT source may be an unpublished later development version. Its
 * manifest must never impersonate the already-signed code9. Extract the
 * runtime manifest from the exact frozen signed ZIP instead (no network).
 */
export function readSignedCode9ArchiveManifest() {
  const archivePath = 'dist/providers/app.tsuzuki.mangaall-9.tsz';
  const extracted = spawnSync('python3', [
    '-c',
    'import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read("manifest.json").decode("utf-8"))',
    archivePath,
  ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 65_536 });
  if (extracted.status !== 0) throw Error('Cannot inspect original signed code9 manifest');
  return JSON.parse(extracted.stdout);
}

export function inspectCurrentSignedCode9Source(consent) {
  const manifest = readSignedCode9ArchiveManifest();
  const payload = JSON.parse(fs.readFileSync('dist/index.payload.json', 'utf8'));
  const archive = fs.readFileSync('dist/providers/app.tsuzuki.mangaall-9.tsz');
  const result = checkSignedCode9SmokeSource({ manifest, payload, archiveBytes: archive, consent });
  verifyRealSignedIndexBeforeNetwork();
  return result;
}
