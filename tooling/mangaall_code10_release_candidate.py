#!/usr/bin/env python3
"""Build an independently reviewable, UNSIGNED MangaALL code10 release candidate.

A development or draft-release source is copied into a disposable tree and
prepared as a 0.5.5/release review ZIP. This command never signs,
dispatches, updates an index, writes to dist/, or creates a release approval.
"""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import zipfile

from build_provider import build

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD_SHA = "d9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622"
PROVIDER_ID = "app.tsuzuki.mangaall"
SAME_FIELDS = (
    "manifestVersion", "id", "name", "minHostApi", "entrypoint",
    "capabilities", "permissions", "contentLanguages", "settings",
)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_candidate(output_dir, *, source_root=ROOT, source_commit=None):
    source_root = pathlib.Path(source_root).resolve()
    output_dir = pathlib.Path(output_dir).resolve()
    if output_dir == source_root or source_root in output_dir.parents:
        raise ValueError("Review output must live OUTSIDE the checked-out repository")
    source_manifest_path = source_root / "providers/mangaall/manifest.json"
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    # Permit the dev-only source or an unmerged, still-UNAPPROVED release
    # promotion PR. Neither state is a signing or publication authorization.
    exact_dev = (source_manifest.get("version") == {"name": "0.5.5-dev", "code": 10}
                 and source_manifest.get("publication") == "development")
    exact_release_candidate = (source_manifest.get("version") == {"name": "0.5.5", "code": 10}
                               and source_manifest.get("publication") == "release")
    if source_manifest.get("id") != PROVIDER_ID or not (exact_dev or exact_release_candidate):
        raise ValueError("Cannot prepare candidate from an unreviewed release or unknown source")
    if (source_root / "review/mangaall-code10/approved-artifact.json").exists():
        raise ValueError("Candidate inspection is not an approved-release workflow")
    ledger_path = source_root / "dist/index.payload.json"
    config_path = source_root / "repository/config.json"
    signed_path = source_root / "dist/index.json"
    original_path = source_root / "dist/providers/app.tsuzuki.mangaall-9.tsz"
    before = {str(p): digest(p) for p in (
        source_manifest_path, ledger_path, config_path, signed_path, original_path,
    )}
    if before[str(original_path)] != OLD_SHA:
        raise ValueError("Published code9 archive SHA does not match the pinned baseline")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    if (config.get("repositoryId") != "app.tsuzuki.providers" or
            config.get("sequence") != 35 or
            ledger.get("repositoryId") != "app.tsuzuki.providers" or
            ledger.get("sequence") != 35 or
            config.get("keyId") != "tsuzuki-provider-root-2026-02"):
        raise ValueError("Signed sequence35 repository identity changed")
    prior = [row for row in ledger.get("providers", []) if row.get("providerId") == PROVIDER_ID]
    if (len(prior) != 1 or prior[0].get("versionCode") != 9 or
            prior[0].get("versionName") != "0.5.4" or prior[0].get("sha256") != OLD_SHA):
        raise ValueError("Unexpected code9 release descriptor")
    checked = subprocess.run(
        ["node", str(source_root / "tooling/verify_index.mjs")],
        cwd=source_root, capture_output=True, text=True, check=False, timeout=30,
    )
    if checked.returncode != 0:
        raise ValueError("Original P-256 signed index did not verify")

    # Work exclusively in a disposable source tree; no 'release' flag ever
    # becomes visible to the main repository's publisher.
    with tempfile.TemporaryDirectory(prefix="mangaall-code10-review-build-") as temp:
        copied = pathlib.Path(temp) / "mangaall"
        shutil.copytree(source_root / "providers/mangaall", copied)
        updated = dict(source_manifest)
        updated["version"] = {"name": "0.5.5", "code": 10}
        updated["publication"] = "release"
        (copied / "manifest.json").write_text(
            json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
        )
        archives = [pathlib.Path(temp) / "candidate-a.tsz", pathlib.Path(temp) / "candidate-b.tsz"]
        for archive in archives:
            build(copied, archive)
        sha = digest(archives[0])
        if sha != digest(archives[1]) or archives[0].read_bytes() != archives[1].read_bytes():
            raise ValueError("Non-deterministic release candidate")
        if sha == OLD_SHA:
            raise ValueError("Code10 cannot reuse the original published code9 artifact")
        with zipfile.ZipFile(original_path) as original, zipfile.ZipFile(archives[0]) as candidate:
            if candidate.testzip() is not None:
                raise ValueError("Corrupt release candidate ZIP")
            old_manifest = json.loads(original.read("manifest.json"))
            new_manifest = json.loads(candidate.read("manifest.json"))
            if (new_manifest.get("version") != {"name": "0.5.5", "code": 10} or
                    "publication" in new_manifest):
                raise ValueError("Unexpected package runtime manifest")
            for field in SAME_FIELDS:
                if (old_manifest.get(field) != new_manifest.get(field) or
                        source_manifest.get(field) != new_manifest.get(field)):
                    raise ValueError("Source permissions or capability grants changed: " + field)
            if "modules/router.js" not in candidate.namelist():
                raise ValueError("Unified three-source router is missing")
            if b"deferredLookupState" not in candidate.read("modules/router.js"):
                raise ValueError("Required bounded terminal failure fix missing")
            if b"MAX_COVERAGE_PAGES = 2" not in candidate.read(
                "modules/sources/mangadex/modules/mangadex.js"
            ):
                raise ValueError("Required bounded MangaDex coverage fix missing")
            if b"tokenKey = Symbol" not in candidate.read("modules/v2-candidate.js"):
                raise ValueError("Missing isolated V2 source observations")
        output_dir.mkdir(parents=True, exist_ok=True)
        artifact = output_dir / "app.tsuzuki.mangaall-10.tsz"
        if artifact.exists():
            raise ValueError("Refusing to overwrite an existing review archive")
        shutil.copyfile(archives[0], artifact)

    review = {
        "reviewStatus": "candidate_unapproved",
        "providerId": PROVIDER_ID,
        "versionCode": 10,
        "versionName": "0.5.5",
        "artifactSha256": sha,
        "sourceCommit": source_commit or "unknown",
        "priorSequence": 35,
        "priorCode9Sha256": OLD_SHA,
        "signed": False,
        "published": False,
    }
    review_path = output_dir / "candidate-review.json"
    review_path.write_text(json.dumps(review, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if before != {str(p): digest(pathlib.Path(p)) for p in before}:
        raise ValueError("Review build modified original signed index, manifest or archive")
    if not artifact.is_file() or digest(artifact) != sha:
        raise ValueError("Review artifact failed after copy")
    return review


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source-commit", default=None)
    args = parser.parse_args()
    result = prepare_candidate(args.output_dir, source_commit=args.source_commit)
    print("MANGAALL_CODE10_RELEASE_CANDIDATE_UNAPPROVED|" +
          json.dumps(result, sort_keys=True))
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as stream:
            stream.write("sha256=" + result["artifactSha256"] + "\n")


if __name__ == "__main__":
    main()
