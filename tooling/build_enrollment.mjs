import crypto from "node:crypto";
import fs from "node:fs";

const config = JSON.parse(fs.readFileSync("repository/config.json", "utf8"));
const publicKey = crypto.createPublicKey(fs.readFileSync("repository/public-key.pem"));
const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
if (publicKey.asymmetricKeyType !== "ec" ||
    publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
  throw new Error("Repository enrollment requires the existing P-256 trust root");
}
const enrollment = {
  displayName: config.displayName,
  repositoryId: config.repositoryId,
  indexUrl: config.indexUrl,
  keyId: config.keyId,
  publicKeyBase64,
};
if (!enrollment.repositoryId || !enrollment.indexUrl.startsWith("https://") ||
    !enrollment.keyId || !enrollment.displayName) {
  throw new Error("Incomplete stable repository enrollment configuration");
}
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/enrollment.json", JSON.stringify(enrollment, null, 2) + "\n");
console.log("Built one-link enrollment for", enrollment.repositoryId);
