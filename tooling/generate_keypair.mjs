import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const keys = path.join(root, ".keys");
const publicPath = path.join(root, "repository/public-key.pem");
const privatePath = path.join(keys, "repository-private.pem");
if (fs.existsSync(publicPath) || fs.existsSync(privatePath)) {
  throw new Error("repository key material already exists; refusing to overwrite trust material");
}
fs.mkdirSync(keys, { recursive: true });
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
fs.writeFileSync(privatePath, privatePem, { mode: 0o600 });
fs.writeFileSync(publicPath, publicPem);
const publicDer = publicKey.export({ type: "spki", format: "der" });
console.log(`private key: ${privatePath}`);
console.log(`public key: ${publicPath}`);
console.log(`P-256 public key (Base64): ${publicDer.toString("base64")}`);
console.log(`fingerprint SHA-256: ${crypto.createHash("sha256").update(publicDer).digest("hex")}`);
