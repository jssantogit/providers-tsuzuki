#!/usr/bin/env python3
"""Fail-closed release preflight for the first signed MangaAll V2/code9.

This checks a proposed package before the existing publication planner or
signer runs. It does NOT sign, publish, or authorize Host/Reader semantics.
The existing signed-index verification must run before this preflight.
"""
import hashlib
import json
import os
import pathlib
import tempfile

from build_provider import build

PROVIDER_ID = "app.tsuzuki.mangaall"
REPOSITORY_ID = "app.tsuzuki.providers"
SIGNING_ROOT_ID = "tsuzuki-provider-root-2026-02"
CODE9_AUTHORIZATION = "PUBLISH_MANGAALL_CODE9"


def _read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def check_code9_publication(root, event_name, authorization):
    root = pathlib.Path(root)
    manifest = _read_json(root / "providers/mangaall/manifest.json")
    config = _read_json(root / "repository/config.json")
    previous = _read_json(root / "dist/index.payload.json")

    if manifest.get("id") != PROVIDER_ID:
        raise ValueError("MangaAll identity changed")
    if config.get("repositoryId") != REPOSITORY_ID or previous.get("repositoryId") != REPOSITORY_ID:
        raise ValueError("MangaAll release requires the existing trusted repository")
    if config.get("keyId") != SIGNING_ROOT_ID:
        raise ValueError("Code9 requires separately reviewed signing-root rotation")
    if config.get("sequence") != previous.get("sequence"):
        raise ValueError("Verify the prior signed publication sequence first")

    prior = [item for item in previous.get("providers", []) if item.get("providerId") == PROVIDER_ID]
    if len(prior) != 1:
        raise ValueError("Expected exactly one published MangaAll in verified index")
    prior = prior[0]
    current_code = manifest.get("version", {}).get("code")
    if type(current_code) is not int:
        raise ValueError("MangaAll version code must be an integer")

    if current_code <= 8:
        return "NO_CODE9_PROMOTION"
    if current_code > 9:
        if current_code == prior.get("versionCode"):
            return "NO_CODE9_PROMOTION"
        raise ValueError("Code10+ requires a separately reviewed publication gate")
    if prior.get("versionCode") >= 9:
        # Subsequent publication of other providers must remain possible.
        # The ordinary planner still enforces immutable same-code artifacts.
        return "NO_CODE9_PROMOTION"
    if prior.get("versionCode") != 8:
        raise ValueError("Code9 must upgrade signed MangaAll code8")

    published_code8 = root / "dist/providers/app.tsuzuki.mangaall-8.tsz"
    if (not published_code8.is_file() or
            hashlib.sha256(published_code8.read_bytes()).hexdigest() != prior.get("sha256")):
        raise ValueError("Published code8 archive does not match the verified index")

    if manifest.get("publication") == "development":
        return "STAGED_ONLY"
    if manifest.get("publication") != "release":
        raise ValueError("Code9 requires explicit publication=release in reviewed source")
    if manifest["version"].get("name") != "0.5.4":
        raise ValueError("First code9 release requires reviewed version 0.5.4")
    if event_name != "workflow_dispatch" or authorization != CODE9_AUTHORIZATION:
        raise ValueError("Code9 requires manual dispatch and explicit operator authorization")

    provider_dir = root / "providers/mangaall"
    main = provider_dir / "main.js"
    v2 = provider_dir / "modules/v2-candidate.js"
    if not main.is_file() or not v2.is_file():
        raise ValueError("Reviewed code9 source entrypoint and V2 module are required")
    if "createMangaAllLookupV2Candidate" not in main.read_text(encoding="utf-8"):
        raise ValueError("Code9 must use the unified three-source V2 router")
    if "UNSIGNED_CANDIDATE_NOT_LIVE" in v2.read_text(encoding="utf-8"):
        raise ValueError("Experimental unsigned provenance cannot be published as code9")

    artifact = root / "dist/providers/app.tsuzuki.mangaall-9.tsz"
    if not artifact.is_file():
        raise ValueError("Code9 release artifact is missing")
    with tempfile.TemporaryDirectory(prefix="mangaall-code9-release-rebuild-") as temp:
        expected = pathlib.Path(temp) / "rebuilt.tsz"
        build(provider_dir, expected)
        if expected.read_bytes() != artifact.read_bytes():
            raise ValueError("Code9 artifact differs from deterministic source rebuild")
    if hashlib.sha256(artifact.read_bytes()).digest() == hashlib.sha256(published_code8.read_bytes()).digest():
        raise ValueError("Code9 cannot reuse signed code8 bytes")
    return "AUTHORIZED_PREFLIGHT_ONLY_NOT_SIGNED"


def main():
    root = pathlib.Path(__file__).resolve().parents[1]
    outcome = check_code9_publication(
        root,
        os.environ.get("MANGAALL_RELEASE_EVENT", ""),
        os.environ.get("MANGAALL_CODE9_AUTHORIZATION", ""),
    )
    print("MANGAALL_CODE9_RELEASE_GATE|outcome=" + outcome)


if __name__ == "__main__":
    main()
