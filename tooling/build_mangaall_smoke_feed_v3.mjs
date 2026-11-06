import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Ephemeral test-only trust root: never modify official publication or re-use
// production signing material. This key is discarded after the signed feed.
const provider = JSON.parse(fs.readFileSync("providers/mangaall/manifest.json", "utf8"));
if (provider.id !== "app.tsuzuki.mangaall" ||
    provider.publication !== "development" ||
    provider.version.code !== 3 || provider.version.name !== "0.3.0") {
  throw new Error("Unexpected MangaAll v3 smoke identity");
}
const packageName = provider.id + "-3.tsz";
const packagePath = path.join("dist", "smoke", "providers", packageName);
const bytes = fs.readFileSync(packagePath);
const baseUrl =
  "https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/tsuzuki/mangaall-smoke-v3-20261106/dist/smoke";
const repositoryId = "app.tsuzuki.mangaall.smoke.v3";
const keyId = "mangaall-smoke-v3-20261106";
const payload = Buffer.from(JSON.stringify({
  schemaVersion: 1,
  repositoryId,
  sequence: 1,
  providers: [{
    providerId: provider.id,
    versionName: provider.version.name,
    versionCode: provider.version.code,
    artifactUrl: baseUrl + "/providers/" + packageName,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    minHostApi: provider.minHostApi,
  }],
  revokedArtifactSha256: [],
  nextSigningKey: null,
}));
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signature = crypto.sign("sha256", payload, privateKey);
if (!crypto.verify("sha256", payload, publicKey, signature)) {
  throw new Error("Cannot verify signed MangaAll v3 test feed");
}
fs.writeFileSync("dist/smoke/index.json", JSON.stringify({
  keyId,
  payloadBase64: payload.toString("base64"),
  signatureBase64: signature.toString("base64"),
}) + "\n");
fs.writeFileSync("dist/smoke/enrollment.json", JSON.stringify({
  repositoryId,
  indexUrl: baseUrl + "/index.json",
  keyId,
  publicKeyBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
}, null, 2) + "\n");
console.log("MangaAll 0.3.0: test-only, separately signed smoke feed v3");
console.log("No private key or production repository was persisted or modified");
