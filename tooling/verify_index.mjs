import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const config = JSON.parse(fs.readFileSync(path.join(root, "repository/config.json"), "utf8"));
const envelope = JSON.parse(fs.readFileSync(path.join(root, "dist/index.json"), "utf8"));
const publicKey = crypto.createPublicKey(fs.readFileSync(path.join(root, "repository/public-key.pem")));
const payload = Buffer.from(envelope.payloadBase64, "base64");
const signature = Buffer.from(envelope.signatureBase64, "base64");

if (envelope.keyId !== config.keyId) {
  throw new Error("signed index keyId does not match repository config");
}
if (!crypto.verify("sha256", payload, publicKey, signature)) {
  throw new Error("signed index signature is invalid");
}

const payloadPath = path.join(root, "dist/index.payload.json");
if (fs.existsSync(payloadPath)) {
  const auditedPayload = fs.readFileSync(payloadPath);
  if (!crypto.timingSafeEqual(payload, auditedPayload)) {
    throw new Error("dist/index.payload.json does not match the signed payload bytes");
  }
}

const index = JSON.parse(payload.toString("utf8"));
if (index.repositoryId !== config.repositoryId || index.sequence !== config.sequence) {
  throw new Error("signed index payload does not match repository config");
}

for (const descriptor of index.providers ?? []) {
  const artifactName = `${descriptor.providerId}-${descriptor.versionCode}.tsz`;
  const expectedUrl = `${config.artifactBaseUrl}/${artifactName}`;
  if (descriptor.artifactUrl !== expectedUrl) {
    throw new Error(`artifact URL does not match repository publication layout: ${descriptor.providerId}`);
  }

  const artifactPath = path.join(root, "dist/providers", artifactName);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`published artifact is missing: ${artifactName}`);
  }

  const actualSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(artifactPath))
    .digest("hex");
  if (actualSha256.toLowerCase() !== String(descriptor.sha256).toLowerCase()) {
    throw new Error(`published artifact SHA-256 mismatch: ${descriptor.providerId}`);
  }
}

console.log(
  `signed repository index verified: ${index.repositoryId} sequence ${index.sequence} (${index.providers?.length ?? 0} Provider(s))`,
);
