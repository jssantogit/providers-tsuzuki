import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const config = JSON.parse(fs.readFileSync(path.join(root, "repository/config.json"), "utf8"));
const providersRoot = path.join(root, "providers");
const distRoot = path.join(root, "dist/providers");

fs.mkdirSync(distRoot, { recursive: true });
const previousIndexFile = path.join(root, "dist/index.payload.json");
const previous = fs.existsSync(previousIndexFile)
  ? JSON.parse(fs.readFileSync(previousIndexFile, "utf8")).providers ?? []
  : [];
const previousById = new Map(previous.map(row => [row.providerId, row]));
if (previousById.size !== previous.length) throw new Error("duplicate signed Provider descriptor");
const descriptors = [];
const seenProviderIds = new Set();
for (const name of fs.readdirSync(providersRoot).sort()) {
  const manifestPath = path.join(providersRoot, name, "manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (seenProviderIds.has(manifest.id)) throw new Error("duplicate Provider in source tree");
  seenProviderIds.add(manifest.id);
  // A future development source can coexist with the last truly signed
  // version. Preserve its exact prior signed descriptor and archive; never
  // silently drop the installed Provider or sign the changed development JS.
  if (manifest.publication === "development") {
    const signed = previousById.get(manifest.id);
    if (signed) {
      if (!Number.isInteger(signed.versionCode) ||
          !Number.isInteger(manifest.version.code) ||
          manifest.version.code <= signed.versionCode) {
        throw new Error("development Provider must be newer than signed version");
      }
      const artifactName = `${manifest.id}-${signed.versionCode}.tsz`;
      const artifactPath = path.join(distRoot, artifactName);
      if (!fs.existsSync(artifactPath) ||
          crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex") !== signed.sha256 ||
          signed.artifactUrl !== `${config.artifactBaseUrl}/${artifactName}`) {
        throw new Error("cannot retain unverified previous signed Provider");
      }
      descriptors.push({ ...signed });
    }
    continue;
  }
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
