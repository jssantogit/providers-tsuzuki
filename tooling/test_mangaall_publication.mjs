import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scripts = [
  ["mangaall-dex", "mangadex", "development"],
  ["mangaall-ball", "mangaball", "development"],
  ["mangaall-dot", "mangadot", "development"],
];
for (const [dir, source, expectedPublication] of scripts) {
  const manifest = JSON.parse(fs.readFileSync("providers/" + dir + "/manifest.json", "utf8"));
  assert.equal(manifest.publication, expectedPublication,
    "MangaAll / " + source + " is a historical internal adapter, never separately installed");
  assert.deepEqual(manifest.capabilities.map(v => v.id), ["reading.lookup", "reading.chapters"],
    "deprecated adapters must not claim Reader pages");
  assert.equal(manifest.permissions.browser.origins.length, 0,
    "metadata-only providers must not receive a browser grant");
}
const retirements = JSON.parse(fs.readFileSync("repository/retirements.json", "utf8"));
assert.deepEqual(retirements.retiredProviderIds, [
  "app.tsuzuki.mangaall.mangadex",
  "app.tsuzuki.mangaall.mangadot",
], "only the accidental source-adapter packages are retired");
assert.equal(retirements.replacementProviderId, "app.tsuzuki.mangaall",
  "retirement must be paired with the unified MangaAll package");
const unified = JSON.parse(fs.readFileSync("providers/mangaall/manifest.json", "utf8"));
assert.equal(unified.id, retirements.replacementProviderId);
assert.equal(unified.version.code, 10);
assert.ok(
  (unified.publication === "development" && unified.version.name === "0.5.5-dev") ||
  (unified.publication === "release" && unified.version.name === "0.5.5"),
  "only an unapproved staging branch may carry the code10 release manifest",
);
const code10LockPath = "review/mangaall-code10/approved-artifact.json";
assert.equal(fs.existsSync(code10LockPath), unified.publication === "release",
  "release manifest must be separately reviewed and tied to code10 approval");
if (fs.existsSync(code10LockPath)) {
  const approval = JSON.parse(fs.readFileSync(code10LockPath, "utf8"));
  assert.equal(approval.reviewStatus, "approved");
  assert.equal(approval.artifactSha256,
    "776d0e8bd64897c30283cad29f1aa331c86dac638deac1f106f042768167b94d");
}
assert.deepEqual(unified.capabilities.map(v => v.id), [
  "reading.lookup", "reading.chapters", "reading.pages",
], "only the single unified package exposes Reader functionality");
assert.equal(JSON.parse(fs.readFileSync("mangaall/product.json", "utf8")).publicationStatus,
  "preview-ready-for-signing", "code8 is a release candidate only until officially signed; no implicit publication");
const published = JSON.parse(fs.readFileSync("providers/mangafire/manifest.json", "utf8"));
assert.notEqual(published.publication, "development");
const workflow = fs.readFileSync(".github/workflows/publish.yml", "utf8");
assert.match(workflow, /manifest\.get\(['"]publication['"]\)\s*==\s*['"]development['"]/,
  "publish workflow must skip development adapters");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mangaall-release-gate-"));
try {
  for (const dir of ["repository", "providers/stable", "providers/experimental", "dist/providers"]) {
    fs.mkdirSync(path.join(temp, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(temp, "repository/config.json"), JSON.stringify({
    schemaVersion: 1, repositoryId: "test.repo", sequence: 1,
    artifactBaseUrl: "https://example.org/provider",
  }));
  const stable = { id: "test.stable", version: { name: "1", code: 1 }, minHostApi: 1 };
  const experimental = { ...stable, id: "test.experimental", publication: "development" };
  const metadata = { ...stable, id: "test.metadata", publication: "metadata-only" };
  fs.writeFileSync(path.join(temp, "providers/stable/manifest.json"), JSON.stringify(stable));
  fs.writeFileSync(path.join(temp, "providers/experimental/manifest.json"), JSON.stringify(experimental));
  fs.mkdirSync(path.join(temp, "providers/metadata"), { recursive: true });
  fs.writeFileSync(path.join(temp, "providers/metadata/manifest.json"), JSON.stringify(metadata));
  fs.writeFileSync(path.join(temp, "dist/providers/test.stable-1.tsz"), "fixture");
  fs.writeFileSync(path.join(temp, "dist/providers/test.metadata-1.tsz"), "fixture");
  const builder = path.resolve("tooling/build_index.mjs");
  const result = spawnSync(process.execPath, [builder], { cwd: temp, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const index = JSON.parse(fs.readFileSync(path.join(temp, "dist/index.payload.json"), "utf8"));
  assert.deepEqual(index.providers.map((provider) => provider.providerId), ["test.metadata", "test.stable"],
    "signed metadata-only sources must be included; development MangaBall stays excluded");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
// A development successor must preserve the ORIGINAL P-256 index entry,
// never replace the installed code9 descriptor with unsigned code10 JS.
const carry = fs.mkdtempSync(path.join(os.tmpdir(), "mangaall-signed-retain-"));
try {
  for (const dir of ["repository", "providers/mangaall", "dist/providers"]) {
    fs.mkdirSync(path.join(carry, dir), { recursive: true });
  }
  const previousArchive = Buffer.from("fixture-signed-code9");
  const previousDescriptor = {
    providerId: "app.tsuzuki.mangaall",
    versionName: "0.5.4", versionCode: 9,
    artifactUrl: "https://example.org/provider/app.tsuzuki.mangaall-9.tsz",
    sha256: crypto.createHash("sha256").update(previousArchive).digest("hex"),
    minHostApi: 1,
  };
  fs.writeFileSync(path.join(carry, "repository/config.json"), JSON.stringify({
    repositoryId: "test.repo", sequence: 35, artifactBaseUrl: "https://example.org/provider",
  }));
  fs.writeFileSync(path.join(carry, "dist/index.payload.json"), JSON.stringify({
    schemaVersion: 1, repositoryId: "test.repo", sequence: 35,
    providers: [previousDescriptor], revokedArtifactSha256: [], nextSigningKey: null,
  }));
  fs.writeFileSync(path.join(carry, "dist/providers/app.tsuzuki.mangaall-9.tsz"), previousArchive);
  fs.writeFileSync(path.join(carry, "providers/mangaall/manifest.json"), JSON.stringify({
    id: "app.tsuzuki.mangaall", version: { name: "0.5.5-dev", code: 10 },
    publication: "development", minHostApi: 1,
  }));
  const buildIndex = () => spawnSync(process.execPath, [path.resolve("tooling/build_index.mjs")],
    { cwd: carry, encoding: "utf8" });
  const retained = buildIndex();
  assert.equal(retained.status, 0, retained.stderr);
  const next = JSON.parse(fs.readFileSync(path.join(carry, "dist/index.payload.json"), "utf8"));
  assert.deepEqual(next.providers, [previousDescriptor], "only the exact prior signed descriptor survives");
  assert.equal(next.sequence, 35, "staged code10 must never bump signed sequence");
  fs.writeFileSync(path.join(carry, "dist/providers/app.tsuzuki.mangaall-9.tsz"), "tampered");
  const rejected = buildIndex();
  assert.notEqual(rejected.status, 0, "reusing a modified published code9 archive must fail closed");
  assert.match(rejected.stderr, /cannot retain unverified previous signed Provider/);
} finally {
  fs.rmSync(carry, { recursive: true, force: true });
}
console.log("MangaAll unified identity, retired source adapters, paused MangaBall: OK");
