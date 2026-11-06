import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPreviewFeed } from "./build_mangaall_preview_feed.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mangaall-preview-"));
const privateKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .privateKey.export({ type: "pkcs8", format: "pem" });
const otherKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .privateKey.export({ type: "pkcs8", format: "pem" });
try {
  for (const p of ["repository", "providers/mangaall", "dist/preview/providers"]) {
    fs.mkdirSync(path.join(temp, p), { recursive: true });
  }
  fs.copyFileSync("repository/mangaall-preview.json", path.join(temp, "repository/mangaall-preview.json"));
  const writeVersion = (code, name, bytes) => {
    fs.writeFileSync(path.join(temp, "providers/mangaall/manifest.json"), JSON.stringify({
      id: "app.tsuzuki.mangaall", publication: "development",
      version: { name, code }, minHostApi: 1,
    }));
    fs.writeFileSync(path.join(temp, `dist/preview/providers/app.tsuzuki.mangaall-${code}.tsz`),
      Buffer.from(bytes));
  };
  writeVersion(4, "0.4.0", "preview-v4");
  const v4 = buildPreviewFeed({ root: temp, privateKeyPem: privateKey });
  assert.deepEqual(v4, { updated: true, sequence: 1 });
  const enrollmentPath = path.join(temp, "dist/preview/enrollment.json");
  const indexPath = path.join(temp, "dist/preview/index.json");
  const pinned = fs.readFileSync(enrollmentPath);
  const signedV4 = fs.readFileSync(indexPath);
  assert.deepEqual(buildPreviewFeed({ root: temp, privateKeyPem: privateKey }),
    { updated: false, sequence: 1 });
  assert.deepEqual(fs.readFileSync(indexPath), signedV4);
  writeVersion(5, "1.0.0", "preview-v5");
  assert.deepEqual(buildPreviewFeed({ root: temp, privateKeyPem: privateKey }),
    { updated: true, sequence: 2 });
  assert.deepEqual(fs.readFileSync(enrollmentPath), pinned,
    "one link and signing identity must remain unchanged across versions");
  writeVersion(6, "1.2.0", "preview-v6");
  assert.deepEqual(buildPreviewFeed({ root: temp, privateKeyPem: privateKey }),
    { updated: true, sequence: 3 });
  assert(fs.existsSync(path.join(temp, "dist/preview/providers/app.tsuzuki.mangaall-4.tsz")));
  assert(fs.existsSync(path.join(temp, "dist/preview/providers/app.tsuzuki.mangaall-5.tsz")));
  assert.throws(() => buildPreviewFeed({ root: temp, privateKeyPem: otherKey }),
    /trust root/);
  writeVersion(5, "1.0.0", "preview-v5");
  assert.throws(() => buildPreviewFeed({ root: temp, privateKeyPem: privateKey }),
    /downgrade/);
  console.log("MangaAll preview: stable signer, monotonic versions, immutable packages: passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
