import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scripts = [
  ["mangaall-dex", "mangadex"],
  ["mangaall-ball", "mangaball"],
  ["mangaall-dot", "mangadot"],
];
for (const [dir, source] of scripts) {
  const manifest = JSON.parse(fs.readFileSync("providers/" + dir + "/manifest.json", "utf8"));
  assert.equal(manifest.publication, "development", "MangaAll / " + source + " must not auto-publish");
}
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
  fs.writeFileSync(path.join(temp, "providers/stable/manifest.json"), JSON.stringify(stable));
  fs.writeFileSync(path.join(temp, "providers/experimental/manifest.json"), JSON.stringify(experimental));
  fs.writeFileSync(path.join(temp, "dist/providers/test.stable-1.tsz"), "fixture");
  const builder = path.resolve("tooling/build_index.mjs");
  const result = spawnSync(process.execPath, [builder], { cwd: temp, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const index = JSON.parse(fs.readFileSync(path.join(temp, "dist/index.payload.json"), "utf8"));
  assert.deepEqual(index.providers.map((provider) => provider.providerId), ["test.stable"],
    "development adapters must never be placed in signed repository index");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log("MangaAll experimental publication gate: OK");
