import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error("MangaAll stable preview publication: " + message);
}

export function buildPreviewFeed({ root = process.cwd(), privateKeyPem } = {}) {
  if (!privateKeyPem) fail("permanent TSUZUKI_MANGAALL_PREVIEW_SIGNING_KEY_PEM secret is required");
  const config = JSON.parse(fs.readFileSync(path.join(root, "repository/mangaall-preview.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "providers/mangaall/manifest.json"), "utf8"));
  const code = manifest.version.code;
  if (config.repositoryId !== "app.tsuzuki.mangaall.preview" ||
      manifest.id !== "app.tsuzuki.mangaall" || manifest.publication !== "development" ||
      !Number.isSafeInteger(code) || code <= 0 ||
      typeof manifest.version.name !== "string" || !manifest.version.name.trim()) {
    fail("identity, development-only channel or provider version does not match invariant");
  }
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey);
  if (publicKey.asymmetricKeyType !== "ec" ||
      publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    fail("signer must be ECDSA P-256");
  }
  const encodedKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const prefix = path.join(root, "dist/preview");
  const indexPath = path.join(prefix, "index.json");
  const enrollmentPath = path.join(prefix, "enrollment.json");
  const artifactName = `${manifest.id}-${code}.tsz`;
  const artifactPath = path.join(prefix, "providers", artifactName);
  const bytes = fs.readFileSync(artifactPath);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const enrollment = {
    displayName: config.displayName,
    repositoryId: config.repositoryId,
    indexUrl: config.indexUrl,
    keyId: config.keyId,
    publicKeyBase64: encodedKey,
  };
  if (!config.indexUrl.startsWith("https://") ||
      !config.artifactBaseUrl.startsWith("https://")) fail("public URLs must use HTTPS");
  let previous = null;
  if (fs.existsSync(enrollmentPath) !== fs.existsSync(indexPath)) {
    fail("index and trust-root enrollment must exist together");
  }
  if (fs.existsSync(indexPath)) {
    const priorEnrollment = JSON.parse(fs.readFileSync(enrollmentPath, "utf8"));
    if (JSON.stringify(priorEnrollment) !== JSON.stringify(enrollment)) {
      fail("stable preview trust root, URLs and repository identity cannot change");
    }
    const signed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (signed.keyId !== config.keyId) fail("previous index key identity mismatch");
    const oldPayload = Buffer.from(signed.payloadBase64, "base64");
    if (!crypto.verify("sha256", oldPayload, publicKey,
      Buffer.from(signed.signatureBase64, "base64"))) {
      fail("previous index signature is invalid under the pinned preview key");
    }
    previous = JSON.parse(oldPayload.toString("utf8"));
    if (previous.repositoryId !== config.repositoryId ||
        !Number.isSafeInteger(previous.sequence) || previous.sequence < 1 ||
        !Array.isArray(previous.providers) || previous.providers.length !== 1 ||
        previous.providers[0].providerId !== manifest.id) {
      fail("existing preview payload does not match one-provider channel");
    }
    const older = previous.providers[0];
    if (code < older.versionCode) fail("provider version downgrade blocked");
    if (code === older.versionCode) {
      if (hash !== older.sha256 || manifest.version.name !== older.versionName) {
        fail("same version code cannot replace an immutable signed artifact");
      }
      return { updated: false, sequence: previous.sequence };
    }
    const priorArchive = path.join(prefix, "providers",
      `${manifest.id}-${older.versionCode}.tsz`);
    if (!fs.existsSync(priorArchive) ||
        crypto.createHash("sha256").update(fs.readFileSync(priorArchive)).digest("hex") !== older.sha256) {
      fail("previous signed provider archive is missing or has been modified");
    }
  }
  const payload = {
    schemaVersion: 1,
    repositoryId: config.repositoryId,
    sequence: (previous?.sequence ?? 0) + 1,
    providers: [{
      providerId: manifest.id,
      versionName: manifest.version.name,
      versionCode: code,
      artifactUrl: config.artifactBaseUrl + "/" + artifactName,
      sha256: hash,
      minHostApi: manifest.minHostApi,
    }],
    revokedArtifactSha256: [],
    nextSigningKey: null,
  };
  const rawPayload = Buffer.from(JSON.stringify(payload));
  const signature = crypto.sign("sha256", rawPayload, privateKey);
  if (!crypto.verify("sha256", rawPayload, publicKey, signature)) fail("new signature invalid");
  fs.mkdirSync(prefix, { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify({
    keyId: config.keyId,
    payloadBase64: rawPayload.toString("base64"),
    signatureBase64: signature.toString("base64"),
  }) + "\n");
  if (!fs.existsSync(enrollmentPath)) {
    fs.writeFileSync(enrollmentPath, JSON.stringify(enrollment, null, 2) + "\n");
  }
  return { updated: true, sequence: payload.sequence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = buildPreviewFeed({
    privateKeyPem: process.env.TSUZUKI_MANGAALL_PREVIEW_SIGNING_KEY_PEM,
  });
  console.log(result.updated ? "Signed new stable MangaAll preview sequence " + result.sequence
                             : "Preview unchanged at verified sequence " + result.sequence);
}
