#!/usr/bin/env python3
"""Prepare a monotonic signed publication without invalidating the existing index.

Run only after verifying the existing signed index and after building every
published .tsz package. This step does not sign or publish anything itself.
"""
import hashlib
import json
import os
import pathlib


def prepare_publication(root: pathlib.Path) -> bool:
    config_path = root / "repository/config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    published = json.loads((root / "dist/index.payload.json").read_text(encoding="utf-8"))

    if config["repositoryId"] != published["repositoryId"]:
        raise ValueError("published repository identity mismatch")
    if config["sequence"] != published["sequence"]:
        raise ValueError("config sequence differs from the signed sequence")

    previous = {item["providerId"]: item for item in published["providers"]}
    if len(previous) != len(published["providers"]):
        raise ValueError("duplicate provider in the signed index")

    current = {}
    changed = False
    for manifest_path in sorted((root / "providers").glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("publication") == "development":
            continue
        identity = manifest["id"]
        if identity in current:
            raise ValueError(f"duplicate provider in source: {identity}")
        current[identity] = manifest
        code = int(manifest["version"]["code"])
        name = manifest["version"]["name"]
        package = root / "dist/providers" / f"{identity}-{code}.tsz"
        if not package.is_file():
            raise ValueError(f"package missing for publication: {identity} code {code}")
        checksum = hashlib.sha256(package.read_bytes()).hexdigest()
        older = previous.get(identity)
        if older is None:
            changed = True
        elif code < older["versionCode"]:
            raise ValueError(f"provider version downgrade: {identity}")
        elif code == older["versionCode"]:
            if name != older["versionName"] or checksum != older["sha256"]:
                raise ValueError(f"published provider artifact is immutable: {identity} code {code}")
        else:
            changed = True

    missing = set(previous) - set(current)
    if missing:
        raise ValueError(f"missing published providers: {', '.join(sorted(missing))}")

    if changed:
        config["sequence"] += 1
        config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed


def main():
    root = pathlib.Path(__file__).resolve().parents[1]
    changed = prepare_publication(root)
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"changed={'true' if changed else 'false'}\n")
    print(f"Publication plan: {'new signed sequence reserved' if changed else 'no changes'}")


if __name__ == "__main__":
    main()
