import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Test-only, separately trusted repository. Never mutate the official signed
// repository, reuse its production signing key, or promote publication metadata.
const provider = JSON.parse(fs.readFileSync("providers/mangaall/manifest.json", "utf8"));
if (provider.id !== "app.tsuzuki.mangaall" || provider.publication !== "development") {
  throw new Error("MangaAll smoke feed must remain development-only");
}
const packageName = provider.id + "-" + provider.version.code + ".tsz";
const packagePath = path.join("dist", "smoke", "providers", packageName);
const bytes = fs.readFileSync(packagePath);
const baseUrl = "https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/tsuzuki/mangaall-smoke-20261105/dist/smoke";
const repositoryId = "app.tsuzuki.mangaall.smoke";
const keyId = "mangaall-smoke-20261105";
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
  throw new Error("Cannot verify smoke repository signature");
}
const pub = publicKey.export({ type: "spki", format: "der" });
const enrollment = {
  repositoryId,
  indexUrl: baseUrl + "/index.json",
  keyId,
  publicKeyBase64: pub.toString("base64"),
};
fs.writeFileSync("dist/smoke/index.json", JSON.stringify({
  keyId,
  payloadBase64: payload.toString("base64"),
  signatureBase64: signature.toString("base64"),
}) + "\n");
fs.writeFileSync("dist/smoke/enrollment.json", JSON.stringify(enrollment, null, 2) + "\n");
console.log("MangaAll DEVELOPMENT smoke feed signed with an ephemeral test-only key.");
console.log("This workflow does not modify official distribution or disclose any signing secret.");
