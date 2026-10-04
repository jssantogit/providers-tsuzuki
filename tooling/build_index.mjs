import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const config = JSON.parse(fs.readFileSync(path.join(root, "repository/config.json"), "utf8"));
const providersRoot = path.join(root, "providers");
const distRoot = path.join(root, "dist/providers");

fs.mkdirSync(distRoot, { recursive: true });
const descriptors = [];
for (const name of fs.readdirSync(providersRoot).sort()) {
  const manifestPath = path.join(providersRoot, name, "manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const artifactName = `${manifest.id}-${manifest.version.code}.tsz`;
  const artifactPath = path.join(distRoot, artifactName);
  if (!fs.existsSync(artifactPath)) throw new Error(`missing built artifact ${artifactPath}`);
  const bytes = fs.readFileSync(artifactPath);
  descriptors.push({
    providerId: manifest.id,
    versionName: manifest.version.name,
    versionCode: manifest.version.code,
    artifactUrl: `${config.artifactBaseUrl}/${artifactName}`,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    minHostApi: manifest.minHostApi,
  });
}

const payload = {
  schemaVersion: 1,
  repositoryId: config.repositoryId,
  sequence: config.sequence,
  providers: descriptors,
  revokedArtifactSha256: [],
  nextSigningKey: null,
};

const output = path.join(root, "dist/index.payload.json");
fs.writeFileSync(output, JSON.stringify(payload));
console.log(`built repository payload sequence ${payload.sequence} -> ${output}`);
