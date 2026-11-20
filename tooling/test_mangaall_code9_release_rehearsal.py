#!/usr/bin/env python3
"""The production publisher is NEVER called: this plan exists only in temp."""
import hashlib
import json
import pathlib
import shutil
import tempfile
import unittest

from mangaall_code9_release_rehearsal import ROOT, rehearse_code9_publication


class MangaAllCode9ReleaseRehearsalTest(unittest.TestCase):
    def test_disposable_unsigned_plan_preserves_current_source_index_and_workflow(self):
        protected = [
            ROOT / "providers/mangaall/manifest.json",
            ROOT / "providers/mangaall/main.js",
            ROOT / "dist/index.payload.json",
            ROOT / "dist/index.json",
            ROOT / "dist/providers/app.tsuzuki.mangaall-8.tsz",
            ROOT / "repository/config.json",
            ROOT / ".github/workflows/publish.yml",
        ]
        before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
        report = rehearse_code9_publication()
        self.assertEqual(report["state"], "UNSIGNED_DISPOSABLE_REHEARSAL_ONLY")
        self.assertEqual(report["previousSequence"], 34)
        self.assertEqual(report["plannedUnsignedSequence"], 35)
        self.assertEqual(report["previousCode"], 8)
        self.assertEqual(report["plannedCode"], 9)
        self.assertTrue(report["otherProvidersUnchanged"])
        self.assertEqual(len(report["artifactSha256"]), 64)
        for key in ("signed", "published", "hostInstalled", "liveNetworkTested"):
            self.assertIs(report[key], False)
        self.assertEqual(
            before,
            {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected},
        )
        self.assertFalse((ROOT / "dist/providers/app.tsuzuki.mangaall-9.tsz").exists())
        self.assertEqual(
            json.loads((ROOT / "providers/mangaall/manifest.json").read_text())["version"],
            {"name": "0.5.3", "code": 8},
        )

    def test_refuses_rehearsal_when_real_manifest_is_no_longer_code8(self):
        with tempfile.TemporaryDirectory(prefix="code9-rehearsal-negative-") as temp:
            source = pathlib.Path(temp)
            for relative in (
                "repository/config.json",
                "dist/index.payload.json",
                "providers/mangaall/manifest.json",
            ):
                dst = source / relative
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / relative, dst)
            source_manifest = source / "providers/mangaall/manifest.json"
            altered = json.loads(source_manifest.read_text())
            altered["version"] = {"name": "0.5.4", "code": 9}
            source_manifest.write_text(json.dumps(altered))
            with self.assertRaisesRegex(ValueError, "code8/index 34 baseline"):
                rehearse_code9_publication(source)


if __name__ == "__main__":
    unittest.main()
