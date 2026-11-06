import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const config = JSON.parse(fs.readFileSync("repository/config.json", "utf8"));
const pem = fs.readFileSync("repository/public-key.pem");
const existing = fs.readFileSync("dist/enrollment.json", "utf8");
const enrollment = JSON.parse(existing);
assert.deepEqual(Object.keys(enrollment).sort(), [
  "displayName", "indexUrl", "keyId", "publicKeyBase64", "repositoryId",
].sort());
assert.equal(enrollment.repositoryId, config.repositoryId);
assert.equal(enrollment.indexUrl, config.indexUrl);
assert.equal(enrollment.keyId, config.keyId);
assert.equal(enrollment.displayName, config.displayName);
assert.equal(enrollment.publicKeyBase64,
  crypto.createPublicKey(pem).export({ type: "spki", format: "der" }).toString("base64"));
assert.equal(enrollment.indexUrl.startsWith("https://"), true);
const dryRun = spawnSync(process.execPath, ["tooling/build_enrollment.mjs"], { encoding: "utf8" });
assert.equal(dryRun.status, 0, dryRun.stderr);
assert.equal(fs.readFileSync("dist/enrollment.json", "utf8"), existing,
  "enrollment link must remain byte-for-byte stable between provider upgrades");
const signed = JSON.parse(fs.readFileSync("dist/index.json", "utf8"));
const index = JSON.parse(Buffer.from(signed.payloadBase64, "base64").toString("utf8"));
assert.equal(index.repositoryId, enrollment.repositoryId,
  "the link must resolve to the identity actually signed by the repository");
console.log("stable one-link repository enrollment contract: passed");
