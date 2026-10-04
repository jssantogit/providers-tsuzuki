import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const config = JSON.parse(fs.readFileSync(path.join(root, "repository/config.json"), "utf8"));
const envelope = JSON.parse(fs.readFileSync(path.join(root, "dist/index.json"), "utf8"));
const publicKey = crypto.createPublicKey(fs.readFileSync(path.join(root, "repository/public-key.pem")));
const payload = Buffer.from(envelope.payloadBase64, "base64");
const signature = Buffer.from(envelope.signatureBase64, "base64");
if (envelope.keyId !== config.keyId) throw new Error("signed index keyId does not match repository config");
if (!crypto.verify("sha256", payload, publicKey, signature)) throw new Error("signed index signature is invalid");
const index = JSON.parse(payload.toString("utf8"));
if (index.repositoryId !== config.repositoryId || index.sequence !== config.sequence) {
  throw new Error("signed index payload does not match repository config");
}
console.log(`signed repository index verified: ${index.repositoryId} sequence ${index.sequence}`);
