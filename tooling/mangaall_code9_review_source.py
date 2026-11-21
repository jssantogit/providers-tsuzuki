#!/usr/bin/env python3
"""Materialize a REVIEW-ONLY MangaAll 0.5.4/code9 source from signed code8.

The immutable code8 ZIP (whose hash is committed in the signed index)
supplies the unchanged three adapters, router and assets. Exactly three
reviewed files are overlaid from review/mangaall-code9/. Nothing under
providers/, dist/, or repository/ is changed, signed, or published.
"""
import base64
import hashlib
import json
import pathlib
import stat
import tempfile
import zipfile

from build_provider import build

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROVIDER_ID = "app.tsuzuki.mangaall"
REPOSITORY_ID = "app.tsuzuki.providers"
KEY_ID = "tsuzuki-provider-root-2026-02"
HOST_PINNED_ROOT_SHA256 = "20875348d95649ff0009e329f0d43de1b84ccf8af7966c215d5e0f449e697159"
OVERLAY = frozenset({
    "manifest.json",
    "main.js",
    "modules/v2-candidate.js",
})
REQUIRED_BASE = frozenset({
    "manifest.json", "main.js", "modules/router.js",
    "modules/sources/mangadex/main.js",
    "modules/sources/mangadot/main.js",
    "modules/sources/mangafire/main.js",
})
MAX_UNCOMPRESSED = 16 * 1024 * 1024
MAX_ENTRY = 2 * 1024 * 1024


def _json(path):
    return json.loads(path.read_text(encoding="utf-8"))


# Immutable sequence-34 published code8 digest, verified against the pinned
# original P-256 signed index by the independent signed-release auditor.
ORIGINAL_CODE8_SHA256 = "4584482d186f2ddb9d5aeb15f98685df56bfa3d556ced4aa5bd51854a7391bb1"
FIRST_SIGNED_CODE9_SHA256 = "d9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622"


def _read_signed_baseline(root):
    """Recover immutable code8 from sequence34 or from the signed seq35 archive.

    Once code10/sequence36 is published, code8 and code9 remain immutable
    archival packages. The current signed seq36 descriptor verifies code10,
    while the original code8 and code9 digests are still pinned by reviewed
    historical evidence and the new operator-approved code10 lock. The
    actual P-256 signature is separately verified by CI verify_index.mjs.
    """
    payload = _json(root / "dist/index.payload.json")
    config = _json(root / "repository/config.json")
    enrollment = _json(root / "dist/enrollment.json")
    sequence = payload.get("sequence")
    if (
        payload.get("repositoryId") != REPOSITORY_ID
        or config.get("repositoryId") != REPOSITORY_ID
        or enrollment.get("repositoryId") != REPOSITORY_ID
        or sequence not in (34, 35, 36)
        or config.get("sequence") != sequence
        or config.get("keyId") != KEY_ID
        or enrollment.get("keyId") != KEY_ID
    ):
        raise ValueError("Code9 review requires a pinned signed code8/code9 trust origin/sequence")
    public_key = base64.b64decode(enrollment["publicKeyBase64"], validate=True)
    if hashlib.sha256(public_key).hexdigest() != HOST_PINNED_ROOT_SHA256:
        raise ValueError("Code9 review root must match the Host pinned P-256 key")
    entries = [e for e in payload["providers"] if e.get("providerId") == PROVIDER_ID]
    if len(entries) != 1:
        raise ValueError("Expected exactly one signed MangaAll descriptor")
    descriptor = entries[0]
    if sequence == 34:
        if (descriptor.get("versionCode") != 8 or
                descriptor.get("versionName") != "0.5.3" or
                descriptor.get("sha256") != ORIGINAL_CODE8_SHA256):
            raise ValueError("Original sequence34 code8 digest changed")
    elif sequence == 35:
        if (descriptor.get("versionCode") != 9 or
                descriptor.get("versionName") != "0.5.4" or
                descriptor.get("sha256") != FIRST_SIGNED_CODE9_SHA256):
            raise ValueError("Published sequence35 code9 digest changed")
    else:
        approval = root / "review/mangaall-code10/approved-artifact.json"
        if not approval.is_file():
            raise ValueError("Sequence36 lacks code10 operator approval lock")
        lock = _json(approval)
        if lock != {
            "reviewStatus": "approved", "versionCode": 10,
            "versionName": "0.5.5",
            "artifactSha256": "bcdfd03ac18c3cfdd0517e08b58dde7efa1f5baa874e93002af28e518860f95f",
            "priorSequence": 35,
            "priorCode9Sha256": FIRST_SIGNED_CODE9_SHA256,
        }:
            raise ValueError("Code10 approval lock does not pin the historic code9 baseline")
        if (descriptor.get("versionCode") != 10 or
                descriptor.get("versionName") != "0.5.5" or
                descriptor.get("sha256") != lock["artifactSha256"]):
            raise ValueError("Signed sequence36 code10 descriptor differs from approved release")
        code10 = root / "dist/providers/app.tsuzuki.mangaall-10.tsz"
        if (not code10.is_file() or
                hashlib.sha256(code10.read_bytes()).hexdigest() != descriptor["sha256"]):
            raise ValueError("Actual code10 ZIP differs from published signed sequence36")
    if sequence in (35, 36):
        published_code9 = root / "dist/providers/app.tsuzuki.mangaall-9.tsz"
        if (not published_code9.is_file() or
                hashlib.sha256(published_code9.read_bytes()).hexdigest() !=
                FIRST_SIGNED_CODE9_SHA256):
            raise ValueError("Published sequence35 code9 archive does not match its signed index")
    archive = root / "dist/providers/app.tsuzuki.mangaall-8.tsz"
    if (not archive.is_file() or
            hashlib.sha256(archive.read_bytes()).hexdigest() != ORIGINAL_CODE8_SHA256):
        raise ValueError("Historical code8 archive does not match its original signed index digest")
    # This helper checks pinned digests, NOT P-256 signatures itself.
    # CI verifies both the archived seq34 signature and current seq35
    # signature through tooling/verify_index.mjs and the release auditor.
    return archive

def _extract_base_archive(archive_path, output):
    with zipfile.ZipFile(archive_path) as bundle:
        files = bundle.infolist()
        names = [entry.filename for entry in files]
        if len(files) > 256 or len(names) != len(set(names)):
            raise ValueError("Duplicate or excessive baseline ZIP entries")
        if not REQUIRED_BASE.issubset(names):
            raise ValueError("Signed code8 is missing a required MangaAll adapter")
        total = 0
        for entry in files:
            relative = pathlib.PurePosixPath(entry.filename)
            unix_type = (entry.external_attr >> 16) & 0o170000
            if (
                entry.is_dir() or
                entry.filename.startswith("/") or
                "\\" in entry.filename or
                ":" in entry.filename or
                not relative.parts or
                any(part in ("", ".", "..") for part in relative.parts) or
                unix_type not in (0, stat.S_IFREG) or
                entry.file_size > MAX_ENTRY
            ):
                raise ValueError("Unsafe code8 source archive entry")
            total += entry.file_size
            if total > MAX_UNCOMPRESSED:
                raise ValueError("Code8 baseline exceeds package size budget")
        for entry in files:
            target = output.joinpath(*pathlib.PurePosixPath(entry.filename).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            data = bundle.read(entry)
            if len(data) != entry.file_size:
                raise ValueError("Corrupt code8 source archive entry")
            target.write_bytes(data)
    return _json(output / "manifest.json")


def materialize_review_code9(output_root, *, root=ROOT):
    """Produce a reproducible UNSIGNED code9 package for offline review only."""
    root = pathlib.Path(root).resolve()
    output_root = pathlib.Path(output_root).resolve()
    if output_root == root or root in output_root.parents:
        raise ValueError("Code9 review output must remain outside the repository")
    if output_root.exists() and any(output_root.iterdir()):
        raise ValueError("Code9 review output directory must be empty")
    archive = _read_signed_baseline(root)
    review = root / "review/mangaall-code9"
    if not review.is_dir():
        raise ValueError("Reviewed code9 source is missing")
    actual_review_files = {
        p.relative_to(review).as_posix() for p in review.rglob("*") if p.is_file()
    }
    if actual_review_files != OVERLAY:
        raise ValueError("Code9 review overlay must contain only the three approved source files")

    output_root.mkdir(parents=True, exist_ok=True)
    staged = output_root / "candidate"
    staged.mkdir()
    base_manifest = _extract_base_archive(archive, staged)
    reviewed_manifest = _json(review / "manifest.json")
    if (
        reviewed_manifest.get("id") != PROVIDER_ID
        or reviewed_manifest.get("version") != {"name": "0.5.4", "code": 9}
        or reviewed_manifest.get("publication") != "development"
        or {k: v for k, v in reviewed_manifest.items() if k not in ("publication", "version")}
        != {k: v for k, v in base_manifest.items() if k != "version"}
    ):
        raise ValueError("Code9 review cannot change code8 identity, capabilities or permissions")

    main = (review / "main.js").read_text(encoding="utf-8")
    v2 = (review / "modules/v2-candidate.js").read_text(encoding="utf-8")
    if (
        main.count("createMangaAllLookupV2Candidate(") != 1
        or main.count('import mangaDex from "./modules/sources/mangadex/main.js"') != 1
        or main.count('import mangaDot from "./modules/sources/mangadot/main.js"') != 1
        or main.count('import mangaFire from "./modules/sources/mangafire/main.js"') != 1
        or "UNSIGNED_CANDIDATE_NOT_LIVE" in v2
        or v2.count('provenance: "V2_READONLY_OBSERVATION",') != 1
        or v2.count("createMangaAllReading(wrapped)") != 1
        or "eligibleForReader: false" not in v2
        or "eligibleForCanonicalBinding: false" not in v2
    ):
        raise ValueError("Code9 review source must preserve tri-source read-only contract")

    for relative in sorted(OVERLAY):
        src = review.joinpath(*pathlib.PurePosixPath(relative).parts)
        dest = staged.joinpath(*pathlib.PurePosixPath(relative).parts)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())

    artifact = output_root / "app.tsuzuki.mangaall-9-REVIEW-UNSIGNED.tsz"
    build(staged, artifact)
    print(
        "MANGAALL_CODE9_REVIEW|code=9|version=0.5.4|state=UNSIGNED_OFFLINE_REVIEW"
        "|source=PINNED_SIGNED_CODE8_PLUS_THREE_OVERLAYS|publishedCode8=UNTOUCHED"
    )
    return artifact


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="mangaall-code9-review-") as folder:
        materialize_review_code9(pathlib.Path(folder))
