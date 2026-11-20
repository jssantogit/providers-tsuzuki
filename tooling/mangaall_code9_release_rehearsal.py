#!/usr/bin/env python3
"""Rehearse the *first* MangaAll code9 publication in a disposable sandbox.

No real repository source, signed index, key, workflow dispatch or installed
provider is changed. This replays release *planning and preflight*, not signing.
It must never be used as an authorization to publish a package.
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile

from build_provider import build
from mangaall_code9_publication_gate import (
    CODE9_AUTHORIZATION,
    check_code9_publication,
)
from mangaall_code9_review_source import (
    ROOT,
    materialize_review_code9,
)
from prepare_publication import prepare_publication


def _sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rehearse_code9_publication(source_root=ROOT):
    """Return only metadata; all rehearsal artifacts are destroyed on return."""
    source_root = pathlib.Path(source_root).resolve()
    original_config = json.loads(
        (source_root / "repository/config.json").read_text(encoding="utf-8")
    )
    original_payload = json.loads(
        (source_root / "dist/index.payload.json").read_text(encoding="utf-8")
    )
    original_manga = next(
        p for p in original_payload["providers"]
        if p["providerId"] == "app.tsuzuki.mangaall"
    )
    source_manifest = json.loads(
        (source_root / "providers/mangaall/manifest.json").read_text(encoding="utf-8")
    )
    if (
        original_config["sequence"] != 34
        or original_payload["sequence"] != 34
        or original_manga["versionCode"] != 8
        or original_manga["versionName"] != "0.5.3"
        or source_manifest["version"] != {"name": "0.5.3", "code": 8}
        or source_manifest["publication"] != "preview"
    ):
        raise ValueError("Rehearsal requires the original code8/index 34 baseline")

    # Verify the *existing* sequence-34 P-256 signature and every published
    # artifact via the official, read-only verifier before any simulated plan.
    # This is not a signature or validation of the prospective code9 archive.
    verified = subprocess.run(
        ["node", str(source_root / "tooling/verify_index.mjs")],
        cwd=source_root, capture_output=True, text=True, check=False, timeout=30,
    )
    if verified.returncode != 0:
        raise ValueError("Existing signed index verification failed: " +
                         verified.stderr[:600])

    # Source-tree and signed payload hashes must not be altered by the trial.
    protected = (
        source_root / "providers/mangaall/manifest.json",
        source_root / "providers/mangaall/main.js",
        source_root / "repository/config.json",
        source_root / "dist/index.payload.json",
        source_root / "dist/index.json",
        source_root / "dist/providers/app.tsuzuki.mangaall-8.tsz",
        source_root / ".github/workflows/publish.yml",
    )
    before = {str(p): _sha256(p) for p in protected}
    with tempfile.TemporaryDirectory(prefix="mangaall-code9-release-rehearsal-") as temp:
        folder = pathlib.Path(temp)
        sandbox = folder / "repository-copy"
        sandbox.mkdir()

        shutil.copytree(source_root / "providers", sandbox / "providers")
        shutil.copytree(source_root / "dist/providers", sandbox / "dist/providers")
        shutil.copytree(source_root / "review/mangaall-code9",
                        sandbox / "review/mangaall-code9")
        for relative in (
            "repository/config.json",
            "dist/index.payload.json",
            "dist/enrollment.json",
        ):
            dest = sandbox / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_root / relative, dest)
        retired = source_root / "repository/retirements.json"
        if retired.is_file():
            shutil.copyfile(retired, sandbox / "repository/retirements.json")
        # IMPORTANT: do not copy the previously signed index. Every planned
        # sequence-35 payload in this sandbox is deliberately UNSIGNED.
        if (sandbox / "dist/index.json").exists():
            raise ValueError("Rehearsal must not contain a signed index")

        review_archive = materialize_review_code9(folder / "reviewed", root=source_root)
        target = sandbox / "providers/mangaall"
        shutil.rmtree(target)
        shutil.copytree(review_archive.parent / "candidate", target)
        manifest_path = target / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("publication") != "development":
            raise ValueError("Review source must start in development state")
        manifest["publication"] = "release"  # SANDBOX ONLY, NEVER SOURCE ROOT
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        release = sandbox / "dist/providers/app.tsuzuki.mangaall-9.tsz"
        build(target, release)
        if release.read_bytes() != review_archive.read_bytes():
            raise ValueError("Release-mode bytes differ from reviewed source bytes")

        # This literal is used only to TEST the positive branch of preflight
        # against a throwaway copy, NOT to dispatch or approve real publishing.
        for event, authorization in (("push", CODE9_AUTHORIZATION),
                                     ("workflow_dispatch", "")):
            try:
                check_code9_publication(sandbox, event, authorization)
            except ValueError as error:
                if "manual dispatch" not in str(error):
                    raise
            else:
                raise ValueError("Unapproved publication unexpectedly passed gate")
        if (check_code9_publication(sandbox, "workflow_dispatch", CODE9_AUTHORIZATION)
                != "AUTHORIZED_PREFLIGHT_ONLY_NOT_SIGNED"):
            raise ValueError("Exact reviewed source did not pass offline preflight")

        # Exercise the normal publication planner and index payload builder
        # in the same isolated directory; NEVER invoke sign_index or git push.
        if not prepare_publication(sandbox):
            raise ValueError("Rehearsal failed to reserve next sandbox sequence")
        result = subprocess.run(
            ["node", str(source_root / "tooling/build_index.mjs")],
            cwd=sandbox, capture_output=True, text=True, check=False, timeout=30,
        )
        if result.returncode != 0:
            raise ValueError("Unsigned index planning failed: " + result.stderr[:600])
        planned = json.loads((sandbox / "dist/index.payload.json").read_text("utf-8"))
        planned_config = json.loads((sandbox / "repository/config.json").read_text("utf-8"))
        planned_manga = [p for p in planned["providers"]
                         if p["providerId"] == "app.tsuzuki.mangaall"]
        if (planned["sequence"] != 35 or planned_config["sequence"] != 35 or
                len(planned_manga) != 1 or
                planned_manga[0]["versionName"] != "0.5.4" or
                planned_manga[0]["versionCode"] != 9 or
                planned_manga[0]["sha256"] != _sha256(release)):
            raise ValueError("Invalid or incomplete unsigned code9 index plan")

        prior_by_id = {p["providerId"]: p for p in original_payload["providers"]}
        next_by_id = {p["providerId"]: p for p in planned["providers"]}
        if prior_by_id.keys() != next_by_id.keys():
            raise ValueError("Rehearsal changed an unrelated provider ID")
        if any(next_by_id[key] != prior_by_id[key]
               for key in prior_by_id if key != "app.tsuzuki.mangaall"):
            raise ValueError("Rehearsal changed an unrelated published provider")
        if _sha256(sandbox / "dist/providers/app.tsuzuki.mangaall-8.tsz") != original_manga["sha256"]:
            raise ValueError("Rehearsal did not preserve immutable code8")

        if (sandbox / "dist/index.json").exists():
            raise ValueError("Unsigned plan must never be represented as signed index")
        report = {
            "state": "UNSIGNED_DISPOSABLE_REHEARSAL_ONLY",
            "previousSequence": 34,
            "plannedUnsignedSequence": 35,
            "previousCode": 8,
            "plannedCode": 9,
            "artifactSha256": _sha256(release),
            "otherProvidersUnchanged": True,
            "signed": False,
            "published": False,
            "hostInstalled": False,
            "liveNetworkTested": False,
        }
    if {str(p): _sha256(p) for p in protected} != before:
        raise ValueError("Rehearsal mutated actual signed source or index")
    return report


if __name__ == "__main__":
    print("MANGAALL_CODE9_RELEASE_REHEARSAL|" +
          json.dumps(rehearse_code9_publication(), sort_keys=True))
