#!/usr/bin/env python3
"""Verify code9 can be STAGED but cannot be mistaken for published code8."""
import hashlib
import json
import pathlib
import subprocess
import tempfile
import unittest
import zipfile

from mangaall_code9_staging import ROOT, PROVIDER, stage_unsigned_code9


class MangaAllCode9StagingTest(unittest.TestCase):
    def test_unsigned_package_is_self_contained_and_preserves_code8(self):
        signed = ROOT / "dist/providers/app.tsuzuki.mangaall-8.tsz"
        code8_manifest = PROVIDER / "manifest.json"
        code8_main = PROVIDER / "main.js"
        original_bytes = {
            "index": (ROOT / "dist/index.payload.json").read_bytes(),
            "signed": signed.read_bytes(),
            "manifest": code8_manifest.read_bytes(),
            "main": code8_main.read_bytes(),
        }
        with tempfile.TemporaryDirectory(prefix="mangaall-unsigned-code9-gate-") as tmp:
            root = pathlib.Path(tmp)
            candidate = stage_unsigned_code9(root)
            self.assertTrue(candidate.is_file())
            self.assertNotEqual(hashlib.sha256(candidate.read_bytes()).hexdigest(),
                                hashlib.sha256(original_bytes["signed"]).hexdigest())
            with zipfile.ZipFile(candidate) as bundle:
                names = bundle.namelist()
                self.assertIn("main.js", names)
                self.assertIn("modules/router.js", names)
                self.assertIn("modules/v2-candidate.js", names)
                self.assertFalse(any(name.endswith(".mjs") for name in names))
                self.assertFalse(any("private" in name.lower() for name in names))
                manifest = json.loads(bundle.read("manifest.json"))
                self.assertEqual(manifest["id"], "app.tsuzuki.mangaall")
                self.assertEqual(manifest["version"]["code"], 9)
                self.assertEqual(manifest["minHostApi"], 1)
                self.assertNotIn("publication", manifest)
                self.assertEqual(
                    [cap["id"] for cap in manifest["capabilities"]],
                    ["reading.lookup", "reading.chapters", "reading.pages"],
                )
                self.assertIn(b"createMangaAllLookupV2Candidate", bundle.read("main.js"))
                self.assertIn(b"eligibleForReader: false", bundle.read("modules/v2-candidate.js"))
            result = subprocess.run(
                ["node", "tooling/test_mangaall_code9_staged_entrypoint.mjs",
                 str(root / "candidate")],
                cwd=ROOT,
                capture_output=True, text=True, check=False, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stdout + "\n" + result.stderr)
            self.assertIn("v2=THREE_SOURCE_READONLY", result.stdout)
            with self.assertRaisesRegex(ValueError, "must be empty"):
                stage_unsigned_code9(root)

        # Code8 remains byte-identical to the published root/index.
        for path, expected in (
            (ROOT / "dist/index.payload.json", original_bytes["index"]),
            (signed, original_bytes["signed"]),
            (code8_manifest, original_bytes["manifest"]),
            (code8_main, original_bytes["main"]),
        ):
            self.assertEqual(path.read_bytes(), expected, str(path))

    def test_staging_refuses_repository_destinations(self):
        with self.assertRaisesRegex(ValueError, "outside the source repository"):
            stage_unsigned_code9(ROOT / "dist" / "candidates")


if __name__ == "__main__":
    unittest.main()
