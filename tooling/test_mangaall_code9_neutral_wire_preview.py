#!/usr/bin/env python3
"""Review code9's neutral V2 wire without signing, publishing or installing it.

The actual deployed code8 archive and index are immutable. The 0.5.4 preview
version deliberately cannot satisfy the Host's signed-installation gate.
"""
import hashlib
import json
import pathlib
import subprocess
import tempfile
import unittest
import zipfile

from build_provider import build
from mangaall_code9_publication_gate import check_code9_publication
from mangaall_code9_staging import (
    ROOT,
    PROVIDER,
    stage_unsigned_code9,
    stage_unsigned_code9_neutral_wire_preview,
)


class MangaAllNeutralWirePreviewTest(unittest.TestCase):
    def test_preview_is_deterministic_neutral_and_does_not_modify_code8(self):
        protected = [
            ROOT / "providers/mangaall/manifest.json",
            ROOT / "providers/mangaall/main.js",
            ROOT / "repository/config.json",
            ROOT / "dist/index.payload.json",
            ROOT / "dist/index.json",
            ROOT / "dist/providers/app.tsuzuki.mangaall-8.tsz",
        ]
        before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
        with tempfile.TemporaryDirectory(prefix="mangaall-code9-neutral-preview-") as temp:
            output = pathlib.Path(temp) / "preview"
            artifact = stage_unsigned_code9_neutral_wire_preview(output)
            self.assertEqual(artifact.name, "app.tsuzuki.mangaall-9-UNSIGNED-NEUTRAL-PREVIEW.tsz")
            self.assertTrue(artifact.is_file())
            self.assertEqual(
                {p.name for p in output.iterdir()},
                {"candidate", artifact.name},
                "No signed index, private key or published repository is produced",
            )
            manifest = json.loads((output / "candidate/manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["id"], "app.tsuzuki.mangaall")
            self.assertEqual(manifest["version"], {"name": "0.5.4-preview-unsigned", "code": 9})
            self.assertEqual(manifest["publication"], "development")
            source = (output / "candidate/modules/v2-candidate.js").read_text(encoding="utf-8")
            self.assertEqual(source.count('provenance: "V2_READONLY_OBSERVATION",'), 1)
            self.assertNotIn("UNSIGNED_CANDIDATE_NOT_LIVE", source)
            self.assertIn("createMangaAllReading(wrapped)", source)
            self.assertIn("SOURCE_ORDER.flatMap", source)
            with zipfile.ZipFile(artifact) as bundle:
                filenames = bundle.namelist()
                self.assertIn("modules/sources/mangadex/main.js", filenames)
                self.assertIn("modules/sources/mangadot/main.js", filenames)
                self.assertIn("modules/sources/mangafire/main.js", filenames)
                self.assertTrue(all(not p.endswith((".pem", ".sig", ".key")) for p in filenames))
                runtime_manifest = json.loads(bundle.read("manifest.json"))
                self.assertEqual(runtime_manifest["version"]["name"], "0.5.4-preview-unsigned")
                self.assertNotIn("publication", runtime_manifest)
                self.assertIn(b"V2_READONLY_OBSERVATION", bundle.read("modules/v2-candidate.js"))
                self.assertNotIn(b"UNSIGNED_CANDIDATE_NOT_LIVE", bundle.read("modules/v2-candidate.js"))
            with tempfile.TemporaryDirectory(prefix="mangaall-preview-rebuild-") as rebuild_dir:
                replay = pathlib.Path(rebuild_dir) / "rebuild.tsz"
                build(output / "candidate", replay)
                self.assertEqual(artifact.read_bytes(), replay.read_bytes())
            result = subprocess.run(
                ["node", "tooling/test_mangaall_code9_staged_entrypoint.mjs", str(output / "candidate")],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + "\n" + result.stderr)
            self.assertIn("v2=THREE_SOURCE_READONLY", result.stdout)
            self.assertIn("wire=V2_READONLY_OBSERVATION", result.stdout)
            with self.assertRaisesRegex(ValueError, "must be empty"):
                stage_unsigned_code9_neutral_wire_preview(output)

        self.assertEqual(
            before,
            {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected},
            "Preview must never mutate the published code8 or repository sequence",
        )
        # Before first release, push was rejected; after official seq35,
        # there is no longer any *pending* code9 promotion for CI to authorize.
        # A temporary unsigned preview still carries zero publish authority.
        sequence = json.loads((ROOT / "dist/index.payload.json").read_text())["sequence"]
        if sequence == 35:
            self.assertEqual(
                check_code9_publication(ROOT, "push", ""),
                "NO_CODE9_PROMOTION",
            )
        else:
            with self.assertRaisesRegex(ValueError, "manual dispatch"):
                check_code9_publication(ROOT, "push", "")
        # Neither unsigned preview can authorize a code9 publish in CI.

    def test_preview_and_legacy_fixture_are_distinct_unsigned_artifacts(self):
        with tempfile.TemporaryDirectory(prefix="mangaall-code9-modes-") as temp:
            base = pathlib.Path(temp)
            legacy = stage_unsigned_code9(base / "legacy")
            neutral = stage_unsigned_code9_neutral_wire_preview(base / "neutral")
            self.assertNotEqual(hashlib.sha256(legacy.read_bytes()).digest(),
                                hashlib.sha256(neutral.read_bytes()).digest())
            with zipfile.ZipFile(legacy) as old, zipfile.ZipFile(neutral) as new:
                self.assertIn(b"UNSIGNED_CANDIDATE_NOT_LIVE", old.read("modules/v2-candidate.js"))
                self.assertIn(b"V2_READONLY_OBSERVATION", new.read("modules/v2-candidate.js"))
                self.assertNotIn(b"V2_READONLY_OBSERVATION", old.read("modules/v2-candidate.js"))
                self.assertNotEqual(
                    json.loads(old.read("manifest.json"))["version"]["name"],
                    json.loads(new.read("manifest.json"))["version"]["name"],
                )
            # Historical code9 previews stay byte-identical, while the source
            # tree can carry a separately unpublished code10 candidate.
            current = json.loads((PROVIDER / "manifest.json").read_text())
            self.assertEqual(current["version"]["code"], 10)
            self.assertEqual(current["publication"], "development")

    def test_preview_refuses_repository_destination(self):
        with self.assertRaisesRegex(ValueError, "outside the source repository"):
            stage_unsigned_code9_neutral_wire_preview(ROOT / "dist" / "neutral-code9")


if __name__ == "__main__":
    unittest.main()
