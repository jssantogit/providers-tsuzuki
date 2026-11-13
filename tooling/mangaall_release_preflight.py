#!/usr/bin/env python3
"""Read-only MangaAll 0.5.2 release preflight against the OFFICIAL signed code6.

Only a disposable copy of the published repository is modified. Never signs
with the official key, increments production repository/config.json, pushes
Git commits, publishes an artifact, or enrolls a user's real device.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

PROVIDER_ID = "app.tsuzuki.mangaall"
REPOSITORY_ID = "app.tsuzuki.providers"
KEY_ID = "tsuzuki-provider-root-2026-02"
PUBLISHED_SEQUENCE = 32
NEXT_SEQUENCE = 33
CODE6_SHA256 = "aa9c101e0764019bc0d09774aeea1600e6bb9f02e12e9c9096f37d0549720320"
CODE7_SHA256 = "cbc7e890fda26138a20358a332c8a700b3aec19ba14c47c53834dc35001673f0"
BASELINE_COMMIT = "3e0b0bc813910929c2215ad26bc46ff5a6a73706"
SIGNING_ROOT_FINGERPRINT = "20875348d95649ff0009e329f0d43de1b84ccf8af7966c215d5e0f449e697159"
PUBLISHED_CODE6 = ("0.5.1", 6)
RELEASE_CODE7 = ("0.5.2", 7)

RELEASE_CRITICAL_FILES = (
    "repository/config.json",
    "repository/public-key.pem",
    "repository/retirements.json",
    "dist/index.json",
    "dist/index.payload.json",
    ".github/workflows/publish.yml",
    "tooling/prepare_publication.py",
    "tooling/build_index.mjs",
    "tooling/build_provider.py",
    "tooling/sign_index.mjs",
    "tooling/verify_index.mjs",
)


class PreflightError(ValueError):
    pass


def require(condition: bool, failure: str) -> None:
    if not condition:
        raise PreflightError(failure)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: pathlib.Path):
    return json.loads(path.read_text(encoding="utf-8"))


def assert_manifest_upgrade(published: dict, candidate: dict) -> None:
    require(published["id"] == candidate["id"] == PROVIDER_ID,
            "MangaAll must retain its single official Provider ID")
    require(
        (published["version"]["name"], published["version"]["code"]) == PUBLISHED_CODE6,
        "Official baseline must be the published code6 version",
    )
    require(
        (candidate["version"]["name"], candidate["version"]["code"]) == RELEASE_CODE7,
        "Release candidate must be code7 / 0.5.2; never mutate code6",
    )
    require(
        published.get("publication") == candidate.get("publication") == "preview",
        "MangaAll must keep the existing explicit preview publication policy",
    )
    old_abi = {key: value for key, value in published.items() if key != "version"}
    new_abi = {key: value for key, value in candidate.items() if key != "version"}
    require(
        old_abi == new_abi,
        "Code7 release modifies stable permissions, capabilities, identity or manifest metadata",
    )


def assert_index_delta(before: dict, after: dict, proposed_sha: str) -> None:
    require(before["schemaVersion"] == after["schemaVersion"] == 1,
            "Provider signed index schema changed")
    require(before["repositoryId"] == after["repositoryId"] == REPOSITORY_ID,
            "Provider repository identity changed")
    require(before["sequence"] == PUBLISHED_SEQUENCE and after["sequence"] == NEXT_SEQUENCE,
            "Expected the exact monotonic signed sequence 32 to 33")
    require(before.get("revokedArtifactSha256", []) == after.get("revokedArtifactSha256", []),
            "Release must not change revocations")
    require(before.get("nextSigningKey") == after.get("nextSigningKey") == None,
            "Release must not rotate the signing key")

    old = {item["providerId"]: item for item in before["providers"]}
    new = {item["providerId"]: item for item in after["providers"]}
    require(len(old) == len(before["providers"]) and len(new) == len(after["providers"]),
            "Duplicate Provider identity in the release index")
    require(old.keys() == new.keys(), "Release must not add or retire unrelated Providers")
    require(PROVIDER_ID in old, "Already-published MangaAll code6 is missing")
    require(
        old[PROVIDER_ID]["versionName"] == PUBLISHED_CODE6[0]
        and old[PROVIDER_ID]["versionCode"] == PUBLISHED_CODE6[1]
        and old[PROVIDER_ID]["sha256"] == CODE6_SHA256,
        "Official MangaAll code6 descriptor is not the audited baseline",
    )

    for provider_id in old.keys() - {PROVIDER_ID}:
        require(old[provider_id] == new[provider_id],
                "Unrelated Provider descriptor changed: " + provider_id)
    expected = old[PROVIDER_ID].copy()
    expected["versionName"] = RELEASE_CODE7[0]
    expected["versionCode"] = RELEASE_CODE7[1]
    expected["sha256"] = proposed_sha
    expected["artifactUrl"] = expected["artifactUrl"].replace(
        PROVIDER_ID + "-6.tsz", PROVIDER_ID + "-7.tsz"
    )
    require(new[PROVIDER_ID] == expected,
            "Proposed MangaAll index descriptor is not exactly code7 + its immutable SHA")


def assert_official_baseline(candidate: pathlib.Path, published: pathlib.Path) -> dict:
    for rel in RELEASE_CRITICAL_FILES:
        require((published / rel).is_file() and (candidate / rel).is_file(),
                "Release-critical file missing: " + rel)
        require((published / rel).read_bytes() == (candidate / rel).read_bytes(),
                "Release-critical publication path changed in candidate: " + rel)

    baseline_config = read_json(published / "repository/config.json")
    require(baseline_config["repositoryId"] == REPOSITORY_ID
            and baseline_config["keyId"] == KEY_ID
            and baseline_config["sequence"] == PUBLISHED_SEQUENCE,
            "Official published repository config has moved; rebaseline before any release")

    enrollment = read_json(published / "dist/enrollment.json")
    require(enrollment["repositoryId"] == REPOSITORY_ID
            and enrollment["keyId"] == KEY_ID
            and enrollment["indexUrl"] == baseline_config["indexUrl"],
            "Published one-link enrollment is not the official repository")
    public_key_der = base64.b64decode(enrollment["publicKeyBase64"], validate=True)
    require(sha256(public_key_der) == SIGNING_ROOT_FINGERPRINT,
            "Published P-256 fingerprint changed without an approved rotation")

    envelope = read_json(published / "dist/index.json")
    require(envelope["keyId"] == KEY_ID, "Official signed index uses an unexpected key")
    signed_payload = base64.b64decode(envelope["payloadBase64"], validate=True)
    require(signed_payload == (published / "dist/index.payload.json").read_bytes(),
            "Published signed envelope differs from its immutable payload")
    index = json.loads(signed_payload)
    require(index["repositoryId"] == REPOSITORY_ID
            and index["sequence"] == PUBLISHED_SEQUENCE,
            "Official signed payload does not describe sequence 32")

    original_code6 = published / "dist/providers" / (PROVIDER_ID + "-6.tsz")
    require(original_code6.is_file()
            and sha256(original_code6.read_bytes()) == CODE6_SHA256,
            "Original published MangaAll code6 archive differs")
    subprocess.run(
        ["node", "tooling/verify_index.mjs"],
        cwd=published,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return index


def assert_other_provider_manifests(candidate: pathlib.Path, published: pathlib.Path) -> None:
    old_paths = {
        p.relative_to(published / "providers").as_posix(): p
        for p in (published / "providers").glob("*/manifest.json")
    }
    new_paths = {
        p.relative_to(candidate / "providers").as_posix(): p
        for p in (candidate / "providers").glob("*/manifest.json")
    }
    require(old_paths.keys() == new_paths.keys(),
            "Provider manifest set changed outside the MangaAll release")
    for rel in old_paths.keys():
        if rel == "mangaall/manifest.json":
            continue
        require(old_paths[rel].read_bytes() == new_paths[rel].read_bytes(),
                "Unrelated Provider manifest changed: " + rel)


def run_preflight(candidate: pathlib.Path, published: pathlib.Path) -> dict:
    candidate = candidate.resolve()
    published = published.resolve()
    require(candidate != published, "Candidate and published baseline must be distinct checkouts")
    before = assert_official_baseline(candidate, published)
    assert_other_provider_manifests(candidate, published)
    old_manifest = read_json(published / "providers/mangaall/manifest.json")
    new_manifest = read_json(candidate / "providers/mangaall/manifest.json")
    assert_manifest_upgrade(old_manifest, new_manifest)

    # This copy is the only writable tree. Real keys and signed index remain
    # immutable; this is strictly a preview of the public publisher's plan.
    with tempfile.TemporaryDirectory(prefix="mangaall-publish-dryrun-") as temporary:
        stage = pathlib.Path(temporary) / "repository-preview"
        stage.mkdir()
        for folder in ("providers", "repository", "dist", "tooling"):
            shutil.copytree(published / folder, stage / folder)
        shutil.copytree(
            candidate / "providers/mangaall",
            stage / "providers/mangaall",
            dirs_exist_ok=True,
        )
        code7_archive = stage / "dist/providers" / (PROVIDER_ID + "-7.tsz")
        subprocess.run(
            [sys.executable, str(candidate / "tooling/build_provider.py"),
             str(candidate / "providers/mangaall"), str(code7_archive)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        package_sha = sha256(code7_archive.read_bytes())
        require(package_sha == CODE7_SHA256,
                "Rebuilt code7 bytes differ from the original Android 9/9-approved package")

        subprocess.run(
            [sys.executable, "tooling/prepare_publication.py"],
            cwd=stage,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        planned_config = read_json(stage / "repository/config.json")
        require(
            {k: v for k, v in planned_config.items() if k != "sequence"}
            == {k: v for k, v in read_json(published / "repository/config.json").items()
                if k != "sequence"},
            "Publisher would silently change the existing trust root or repository URLs",
        )
        require(planned_config["sequence"] == NEXT_SEQUENCE,
                "Publisher must propose exactly one new index sequence")
        subprocess.run(
            ["node", "tooling/build_index.mjs"],
            cwd=stage,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        after = read_json(stage / "dist/index.payload.json")
        assert_index_delta(before, after, package_sha)

        # No index signature is generated during this preflight.
        require((stage / "dist/index.json").read_bytes() ==
                (published / "dist/index.json").read_bytes(),
                "Dry-run must never replace the live signed index")
        require(sha256((stage / "dist/providers" / (PROVIDER_ID + "-6.tsz")).read_bytes())
                == CODE6_SHA256, "Dry-run modified the immutable rollback archive")

    return {
        "providerId": PROVIDER_ID,
        "versionFrom": "0.5.1",
        "versionTo": "0.5.2",
        "codeFrom": 6,
        "codeTo": 7,
        "repositoryId": REPOSITORY_ID,
        "keyId": KEY_ID,
        "sequenceFrom": PUBLISHED_SEQUENCE,
        "proposedSequence": NEXT_SEQUENCE,
        "originalCode7Sha256": CODE7_SHA256,
        "changedProviderIds": [PROVIDER_ID],
        "officialCode7Signed": False,
        "published": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=pathlib.Path, default=pathlib.Path("."))
    parser.add_argument("--published", type=pathlib.Path, required=True)
    args = parser.parse_args()
    try:
        result = run_preflight(args.candidate, args.published)
    except (PreflightError, subprocess.CalledProcessError, OSError, ValueError, KeyError) as error:
        print("MANGAALL_RELEASE_PREFLIGHT|outcome=FAIL|reason="
              + error.__class__.__name__, file=sys.stderr)
        return 1
    print("MANGAALL_RELEASE_PREFLIGHT|outcome=PASS|"
          "provider=app.tsuzuki.mangaall|code=6->7|sequence=32->33|"
          "root=UNCHANGED|unrelatedProviders=UNCHANGED|"
          "code7=ANDROID_9_OF_9_PINNED_BYTES|officialSigning=NOT_TESTED|published=NO")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
