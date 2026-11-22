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
            ROOT / "dist/providers/app.tsuzuki.mangaall-9.tsz",
            ROOT / "dist/providers/app.tsuzuki.mangaall-10.tsz",
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
        # Current official index is signed seq36/code10. The test rehearses
        # historical unsigned code9 only against the genuine seq34 fixture,
        # preserving current signed and archived release bytes.
        descriptor = next(p for p in json.loads(
            (ROOT / "dist/index.payload.json").read_text()
        )["providers"] if p["providerId"] == "app.tsuzuki.mangaall")
        self.assertEqual(descriptor["versionCode"], 10)
        self.assertEqual(descriptor["versionName"], "0.5.5")
        self.assertEqual(
            descriptor["sha256"],
            hashlib.sha256((ROOT / "dist/providers/app.tsuzuki.mangaall-10.tsz").read_bytes()).hexdigest(),
        )
        self.assertEqual(
            hashlib.sha256((ROOT / "dist/providers/app.tsuzuki.mangaall-9.tsz").read_bytes()).hexdigest(),
            "d9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622",
        )
        candidate = json.loads((ROOT / "providers/mangaall/manifest.json").read_text())
        self.assertEqual(candidate["version"]["code"], 10)
        self.assertIn(
            (candidate["version"]["name"], candidate["publication"]),
            {("0.5.5-dev", "development"), ("0.5.5", "release")},
        )
        # Rehearsal builds historical code9 ONLY in a throwaway sandbox.
        # It must never promote this future candidate into the signed index.

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
            altered["version"] = {"name": "0.5.6", "code": 10}
            source_manifest.write_text(json.dumps(altered))
            with self.assertRaisesRegex(ValueError, "code8/index 34 baseline"):
                rehearse_code9_publication(source)


if __name__ == "__main__":
    unittest.main()
