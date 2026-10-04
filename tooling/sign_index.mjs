import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const config = JSON.parse(fs.readFileSync(path.join(root, "repository/config.json"), "utf8"));
const payloadPath = path.join(root, "dist/index.payload.json");
const publicKeyPath = path.join(root, "repository/public-key.pem");
const privateKeyPem = process.env.TSUZUKI_PROVIDER_SIGNING_KEY_PEM;

if (!privateKeyPem) throw new Error("TSUZUKI_PROVIDER_SIGNING_KEY_PEM is required");
if (!fs.existsSync(payloadPath)) throw new Error("dist/index.payload.json must be built first");
if (!fs.existsSync(publicKeyPath)) throw new Error("repository/public-key.pem is missing");

const privateKey = crypto.createPrivateKey(privateKeyPem);
const derivedPublic = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
const pinnedPublic = crypto.createPublicKey(fs.readFileSync(publicKeyPath)).export({ type: "spki", format: "der" });
if (!crypto.timingSafeEqual(derivedPublic, pinnedPublic)) {
  throw new Error("signing secret does not match repository/public-key.pem");
}

const payload = fs.readFileSync(payloadPath);
const signature = crypto.sign("sha256", payload, privateKey);
const envelope = {
  keyId: config.keyId,
  payloadBase64: payload.toString("base64"),
  signatureBase64: signature.toString("base64"),
};
fs.writeFileSync(path.join(root, "dist/index.json"), JSON.stringify(envelope));
console.log("signed dist/index.json");
