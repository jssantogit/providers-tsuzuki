#!/usr/bin/env python3
"""Read-only post-publication audit: only REAL official P-256 signed code9.

This script neither signs nor builds an index. It refuses the current signed
code8/sequence34 baseline. A passing run requires a newly signed index
sequence35 binding exactly the reviewed code9 bytes and preserving code8.
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import zipfile

from build_provider import build
from mangaall_code9_review_source import (
    HOST_PINNED_ROOT_SHA256,
    materialize_review_code9,
)

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROVIDER_ID = "app.tsuzuki.mangaall"
REPOSITORY_ID = "app.tsuzuki.providers"
KEY_ID = "tsuzuki-provider-root-2026-02"


def _read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verify_official_signed_index(root):
    result = subprocess.run(
        ["node", "tooling/verify_index.mjs"],
        cwd=root, capture_output=True, text=True, timeout=30, check=False,
    )
    if result.returncode != 0:
        raise ValueError("P-256 signed index verification failed: " + result.stderr[:250])


def audit_signed_code9(current_root, published_code8_root):
    current = pathlib.Path(current_root).resolve()
    prior = pathlib.Path(published_code8_root).resolve()
    if current == prior:
        raise ValueError("Code8 historical snapshot must be separate from current release")
    _verify_official_signed_index(prior)
    _verify_official_signed_index(current)

    old_index = _read_json(prior / "dist/index.payload.json")
    new_index = _read_json(current / "dist/index.payload.json")
    old_config = _read_json(prior / "repository/config.json")
    new_config = _read_json(current / "repository/config.json")
    old_enrollment = _read_json(prior / "dist/enrollment.json")
    new_enrollment = _read_json(current / "dist/enrollment.json")
    if (
        old_index.get("sequence") != old_config.get("sequence") or
        old_index.get("sequence") != 34 or
        new_index.get("sequence") != new_config.get("sequence") or
        new_index.get("sequence") != 35
    ):
        raise ValueError("Real code9 requires published sequence 35 (code8 baseline 34)")
    if any(
        record.get("repositoryId") != REPOSITORY_ID for record in
        (old_index, new_index, old_config, new_config, old_enrollment, new_enrollment)
    ):
        raise ValueError("Repository identity changed")
    if any(record.get("keyId") != KEY_ID for record in
           (old_config, new_config, old_enrollment, new_enrollment)):
        raise ValueError("Repository signing root changed")
    import base64
    old_der = base64.b64decode(old_enrollment["publicKeyBase64"], validate=True)
    new_der = base64.b64decode(new_enrollment["publicKeyBase64"], validate=True)
    if old_der != new_der or hashlib.sha256(old_der).hexdigest() != HOST_PINNED_ROOT_SHA256:
        raise ValueError("Published code9 requires original Host pinned P-256 root")

    old_by_id = {p["providerId"]: p for p in old_index["providers"]}
    new_by_id = {p["providerId"]: p for p in new_index["providers"]}
    if (
        len(old_by_id) != len(old_index["providers"]) or
        len(new_by_id) != len(new_index["providers"]) or
        old_by_id.keys() != new_by_id.keys()
    ):
        raise ValueError("New signed sequence altered Provider identity set")
    if any(old_by_id[k] != new_by_id[k] for k in old_by_id if k != PROVIDER_ID):
        raise ValueError("New signed sequence modified unrelated Providers")
    old = old_by_id[PROVIDER_ID]
    new = new_by_id[PROVIDER_ID]
    if (
        old["versionCode"] != 8 or old["versionName"] != "0.5.3" or
        new["versionCode"] != 9 or new["versionName"] != "0.5.4" or
        old["minHostApi"] != new["minHostApi"] or
        new["artifactUrl"] != new_config["artifactBaseUrl"] + "/" +
        "app.tsuzuki.mangaall-9.tsz"
    ):
        raise ValueError("Signed code9 descriptor differs from the reviewed upgrade")
    code8 = prior / "dist/providers/app.tsuzuki.mangaall-8.tsz"
    official_code8 = current / "dist/providers/app.tsuzuki.mangaall-8.tsz"
    code9 = current / "dist/providers/app.tsuzuki.mangaall-9.tsz"
    if _digest(code8) != old["sha256"] or _digest(official_code8) != old["sha256"]:
        raise ValueError("Original code8 archive changed during publication")
    if _digest(code9) != new["sha256"] or _digest(code9) == old["sha256"]:
        raise ValueError("Signed code9 artifact is missing or digest differs")

    manifest = _read_json(current / "providers/mangaall/manifest.json")
    source_is_code9 = (
        manifest.get("id") == PROVIDER_ID and
        manifest.get("version") == {"name": "0.5.4", "code": 9} and
        manifest.get("publication") == "release"
    )
    source_is_unpublished_code10 = (
        manifest.get("id") == PROVIDER_ID and
        manifest.get("version") == {"name": "0.5.5-dev", "code": 10} and
        manifest.get("publication") == "development"
    )
    # An archived code9 P-256 audit is NOT the code10 authorization gate.
    # It must remain usable to verify immutable code9 before a separately
    # approved code10 release (without granting that release any authority).
    source_is_code10_release_review = (
        manifest.get("id") == PROVIDER_ID and
        manifest.get("version") == {"name": "0.5.5", "code": 10} and
        manifest.get("publication") == "release"
    )
    if not (source_is_code9 or source_is_unpublished_code10 or source_is_code10_release_review):
        raise ValueError("Published code9 source manifest is inconsistent")
    # Source-only 'publication' is stripped from the signed runtime ZIP.
    # Under code10 development or unapproved review, attest code9 by archive
    # and independent review, never the deliberately changed working tree.
    with zipfile.ZipFile(code9) as archive:
        runtime_manifest = json.loads(archive.read("manifest.json"))
    if (runtime_manifest.get("id") != PROVIDER_ID or
            runtime_manifest.get("version") != {"name": "0.5.4", "code": 9} or
            "publication" in runtime_manifest):
        raise ValueError("Original signed code9 runtime manifest differs from reviewed version")
    with tempfile.TemporaryDirectory(prefix="mangaall-code9-signed-release-audit-") as temp:
        scratch = pathlib.Path(temp)
        baseline = scratch / "baseline"
        for relative in (
            "repository/config.json",
            "dist/index.payload.json",
            "dist/enrollment.json",
            "dist/providers/app.tsuzuki.mangaall-8.tsz",
        ):
            dst = baseline / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(prior / relative, dst)
        shutil.copytree(current / "review/mangaall-code9",
                        baseline / "review/mangaall-code9")
        audited = materialize_review_code9(scratch / "reviewed", root=baseline)
        if audited.read_bytes() != code9.read_bytes():
            raise ValueError("Signed code9 differs from immutable source review")
        if source_is_code9:
            rebuilt = scratch / "rebuilt-from-source.tsz"
            build(current / "providers/mangaall", rebuilt)
            if rebuilt.read_bytes() != code9.read_bytes():
                raise ValueError("Signed code9 differs from current code9 source rebuild")
        # Unpublished code10 MUST differ; rebuilding the working tree against
        # the immutable code9 signature would incorrectly mark development
        # as a tampered publication. It has no publish/signing authority.

    return {
        "state": "OFFICIAL_CODE9_SIGNED_INDEX_VERIFIED",
        "repositoryId": REPOSITORY_ID,
        "sequence": 35,
        "versionCode": 9,
        "artifactSha256": _digest(code9),
        "trustAnchorSha256": HOST_PINNED_ROOT_SHA256,
        "otherProvidersUnchanged": True,
        "hostInstalled": False,
        "liveCdnTested": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--code8-snapshot", required=True, type=pathlib.Path)
    parser.add_argument("--current", type=pathlib.Path, default=ROOT)
    args = parser.parse_args()
    print("MANGAALL_CODE9_SIGNED_RELEASE_AUDIT|" +
          json.dumps(audit_signed_code9(args.current, args.code8_snapshot), sort_keys=True))
