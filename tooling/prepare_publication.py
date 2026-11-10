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

    # Retire only the two accidentally shipped MangaAll source adapters, and
    # only as part of the atomic signed publication of the single unified ID.
    # Never remove immutable archives: existing installations may need them
    # for audit/recovery even though new catalog discovery must not expose them.
    retirements_path = root / "repository/retirements.json"
    retired = set()
    if retirements_path.is_file():
        plan = json.loads(retirements_path.read_text(encoding="utf-8"))
        declared = plan.get("retiredProviderIds", [])
        if not isinstance(declared, list) or len(declared) != len(set(declared)):
            raise ValueError("retired provider IDs must be a unique list")
        retired = set(declared)
        permitted = {
            "app.tsuzuki.mangaall.mangadex",
            "app.tsuzuki.mangaall.mangadot",
        }
        if retired - permitted:
            raise ValueError("not a permitted legacy MangaAll adapter: " +
                             ", ".join(sorted(retired - permitted)))
        if retired:
            replacement = plan.get("replacementProviderId")
            if replacement != "app.tsuzuki.mangaall" or replacement not in current:
                raise ValueError("unified MangaAll replacement must be included in the same signed sequence")
            if current[replacement]["version"]["code"] < 5:
                raise ValueError("unified MangaAll replacement must be version code 5 or greater")
            if retired & set(current):
                raise ValueError("retired legacy adapter cannot also be published")

    missing = set(previous) - set(current)
    unexpected = missing - retired
    if unexpected:
        raise ValueError(f"missing published providers: {', '.join(sorted(unexpected))}")
    for identity in missing:
        prior = previous[identity]
        package = root / "dist/providers" / f"{identity}-{prior['versionCode']}.tsz"
        if not package.is_file() or hashlib.sha256(package.read_bytes()).hexdigest() != prior["sha256"]:
            raise ValueError(f"legacy MangaAll adapter archive is missing or modified: {identity}")
    if missing:
        changed = True

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
