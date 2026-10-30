import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scripts = [
  ["mangaall-dex", "mangadex", "metadata-only"],
  ["mangaall-ball", "mangaball", "development"],
  ["mangaall-dot", "mangadot", "metadata-only"],
];
for (const [dir, source, expectedPublication] of scripts) {
  const manifest = JSON.parse(fs.readFileSync("providers/" + dir + "/manifest.json", "utf8"));
  assert.equal(manifest.publication, expectedPublication,
    "MangaAll / " + source + " must honor metadata-only release or paused isolation");
  assert.deepEqual(manifest.capabilities.map(v => v.id), ["reading.lookup", "reading.chapters"],
    "the signed metadata release must not imply Reader pages or arbitrary capabilities");
  assert.equal(manifest.permissions.browser.origins.length, 0,
    "metadata-only providers must not receive a browser grant");
}
assert.equal(JSON.parse(fs.readFileSync("mangaall/product.json", "utf8")).publicationStatus,
  "metadata-only-preview", "MangaAll must not promise readable pages");
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
console.log("MangaAll signed metadata-only MangaDex/MangaDot, paused MangaBall publication gate: OK");
