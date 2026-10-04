#!/usr/bin/env python3
import json
import pathlib
import re
import tempfile

from build_provider import build

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROVIDERS = ROOT / "providers"
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
CAP_RE = re.compile(r"[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
SUPPORTED_CAPABILITIES = {
    ("reading.lookup", 1),
    ("reading.chapters", 1),
    ("reading.pages", 1),
    ("torrent.search", 1),
    ("debrid.resolve", 1),
    ("acquisition.p2p", 1),
}


def validate_manifest(path: pathlib.Path):
    manifest = json.loads(path.read_text(encoding="utf-8"))
    required = {"manifestVersion", "id", "name", "version", "minHostApi", "entrypoint", "capabilities"}
    missing = required - set(manifest)
    if missing:
        raise SystemExit(f"{path}: missing {sorted(missing)}")
    if manifest["manifestVersion"] != 1:
        raise SystemExit(f"{path}: unsupported manifestVersion")
    if not ID_RE.fullmatch(manifest["id"]):
        raise SystemExit(f"{path}: invalid Provider id")
    version = manifest["version"]
    if not version.get("name") or int(version.get("code", 0)) <= 0:
        raise SystemExit(f"{path}: invalid version")
    if int(manifest["minHostApi"]) <= 0:
        raise SystemExit(f"{path}: invalid minHostApi")
    seen = set()
    for capability in manifest["capabilities"]:
        key = (capability.get("id"), int(capability.get("version", 0)))
        if not CAP_RE.fullmatch(key[0] or "") or key[1] <= 0:
            raise SystemExit(f"{path}: invalid capability {capability}")
        if key in seen:
            raise SystemExit(f"{path}: duplicated capability {key}")
        if key not in SUPPORTED_CAPABILITIES:
            raise SystemExit(f"{path}: capability not in current Tsuzuki V1 contract: {key}")
        seen.add(key)
    entrypoint = path.parent / manifest["entrypoint"]
    if not entrypoint.is_file():
        raise SystemExit(f"{path}: entrypoint does not exist")
    return manifest


def main():
    provider_dirs = sorted(path.parent for path in PROVIDERS.glob("*/manifest.json"))
    if not provider_dirs:
        raise SystemExit("repository has no Providers")
    ids = set()
    with tempfile.TemporaryDirectory() as tmp:
        for provider_dir in provider_dirs:
            manifest = validate_manifest(provider_dir / "manifest.json")
            if manifest["id"] in ids:
                raise SystemExit(f"duplicate Provider id: {manifest['id']}")
            ids.add(manifest["id"])
            build(provider_dir, pathlib.Path(tmp) / f"{manifest['id']}.tsz")
    print(f"repository conformance: OK ({len(provider_dirs)} Provider(s))")


if __name__ == "__main__":
    main()
