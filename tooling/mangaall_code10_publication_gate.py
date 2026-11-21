#!/usr/bin/env python3
"""Fail-closed pre-signature gate for a *future* independently reviewed code10.

Does not sign, upload, mutate the repository or authorize Host editorial grants.
The active development candidate (0.5.5-dev/code10) cannot be published.
"""
import hashlib
import hmac
import json
import pathlib
import re
import subprocess
import tempfile
import zipfile

from build_provider import build

PROVIDER_ID = "app.tsuzuki.mangaall"
REPOSITORY_ID = "app.tsuzuki.providers"
SIGNING_ROOT_ID = "tsuzuki-provider-root-2026-02"
PRIOR_SHA = "d9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622"
APPROVAL = "PUBLISH_MANGAALL_CODE10"
HEX_SHA = re.compile(r"[0-9a-f]{64}\Z")
REVIEW_FILE = "review/mangaall-code10/approved-artifact.json"
UNCHANGED_MANIFEST = (
    "manifestVersion", "id", "name", "minHostApi", "entrypoint",
    "capabilities", "permissions", "contentLanguages", "settings",
)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_code10_publication(root, event_name, authorization, approved_sha):
    root = pathlib.Path(root).resolve()
    source_manifest = read_json(root / "providers/mangaall/manifest.json")
    if source_manifest.get("id") != PROVIDER_ID:
        raise ValueError("MangaAll source identity changed")
    version = source_manifest.get("version")
    if not isinstance(version, dict) or type(version.get("code")) is not int:
        raise ValueError("MangaAll code10 requires a well-formed numeric version")
    if version["code"] != 10:
        raise ValueError("Not a code10 release; dispatch through historical code9 gate")
    if source_manifest.get("publication") == "development":
        if version != {"name": "0.5.5-dev", "code": 10}:
            raise ValueError("Unpublished code10 version changed")
        return "DEVELOPMENT_ONLY_NOT_SIGNED"
    if source_manifest.get("publication") != "release" or version != {"name": "0.5.5", "code": 10}:
        raise ValueError("Code10 requires separately reviewed 0.5.5 release manifest")

    # An operator must explicitly approve *these exact bytes*, not merely the
    # version number. The independently committed review record must agree.
    if event_name != "workflow_dispatch" or authorization != APPROVAL:
        raise ValueError("Code10 requires manual workflow dispatch and explicit approval")
    if not isinstance(approved_sha, str) or not HEX_SHA.fullmatch(approved_sha):
        raise ValueError("Code10 manual approval must include exact 64-char artifact SHA256")
    review_path = root / REVIEW_FILE
    if not review_path.is_file():
        raise ValueError("Code10 requires an independently reviewed artifact lock")
    review = read_json(review_path)
    if set(review) != {
        "reviewStatus", "versionCode", "versionName", "artifactSha256",
        "priorSequence", "priorCode9Sha256",
    } or review != {
        "reviewStatus": "approved",
        "versionCode": 10,
        "versionName": "0.5.5",
        "artifactSha256": approved_sha,
        "priorSequence": 35,
        "priorCode9Sha256": PRIOR_SHA,
    }:
        raise ValueError("Code10 review lock does not match manual artifact approval")

    config = read_json(root / "repository/config.json")
    prior = read_json(root / "dist/index.payload.json")
    if (config.get("repositoryId") != REPOSITORY_ID or
            prior.get("repositoryId") != REPOSITORY_ID or
            config.get("keyId") != SIGNING_ROOT_ID or
            config.get("sequence") != prior.get("sequence") or
            prior.get("sequence") != 35):
        raise ValueError("Code10 requires the original signed sequence35 repository")
    rows = [entry for entry in prior.get("providers", []) if entry.get("providerId") == PROVIDER_ID]
    if len(rows) != 1 or rows[0].get("versionCode") != 9 or (
        rows[0].get("versionName") != "0.5.4"
    ) or rows[0].get("sha256") != PRIOR_SHA:
        raise ValueError("Code10 requires exactly one original signed code9 descriptor")
    original = root / "dist/providers/app.tsuzuki.mangaall-9.tsz"
    if not original.is_file() or not hmac.compare_digest(sha256(original), PRIOR_SHA):
        raise ValueError("Immutable published MangaAll code9 archive changed")
    verification = subprocess.run(
        ["node", "tooling/verify_index.mjs"], cwd=root,
        capture_output=True, text=True, timeout=30, check=False,
    )
    if verification.returncode != 0:
        raise ValueError("Code10 requires verified original P-256 signed index")

    artifact = root / "dist/providers/app.tsuzuki.mangaall-10.tsz"
    if not artifact.is_file() or not hmac.compare_digest(sha256(artifact), approved_sha):
        raise ValueError("Code10 archive differs from reviewed manual artifact digest")
    if hmac.compare_digest(approved_sha, PRIOR_SHA):
        raise ValueError("Code10 cannot reuse code9 signed archive")

    # Verify the exact network permissions, browser grants and Host capabilities
    # match code9; a new scope must go through a different explicit review.
    with zipfile.ZipFile(original) as old_zip, zipfile.ZipFile(artifact) as new_zip:
        old_manifest = json.loads(old_zip.read("manifest.json"))
        runtime_manifest = json.loads(new_zip.read("manifest.json"))
        if (runtime_manifest.get("version") != {"name": "0.5.5", "code": 10} or
                "publication" in runtime_manifest or
                any(source_manifest.get(field) != old_manifest.get(field) or
                    runtime_manifest.get(field) != old_manifest.get(field)
                    for field in UNCHANGED_MANIFEST)):
            raise ValueError("Code10 changed signed Host manifest grants or identity")

    with tempfile.TemporaryDirectory(prefix="mangaall-code10-reviewed-rebuild-") as temp:
        rebuilt = pathlib.Path(temp) / "rebuilt.tsz"
        build(root / "providers/mangaall", rebuilt)
        if not hmac.compare_digest(sha256(rebuilt), approved_sha):
            raise ValueError("Code10 source differs from reviewed deterministic package")

    return "AUTHORIZED_CODE10_PREFLIGHT_ONLY_NOT_SIGNED"
