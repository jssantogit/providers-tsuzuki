"""Exact-byte operator-approved code10 RELEASE, never signing within tests.

This test proves the approved 0.5.5 code10 bytes are reproducible,
that the real signed code9 seq35 remains immutable, and that a push,
wrong token or wrong hash cannot authorize the signer. The actual
workflow_dispatch on main remains an explicit independent operation.
"""
import hashlib
import json
import pathlib
import subprocess
import tempfile
import unittest

from build_provider import build
from mangaall_code10_publication_gate import (
    APPROVAL, PRIOR_SHA, REVIEW_FILE, check_code10_publication,
)

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHA = "776d0e8bd64897c30283cad29f1aa331c86dac638deac1f106f042768167b94d"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Code10OperatorApprovedReleaseReview(unittest.TestCase):
    def test_approved_release_bytes_match_locked_sha_and_old_signed_index(self):
        manifest = json.loads((ROOT / "providers/mangaall/manifest.json").read_text())
        self.assertEqual(manifest["id"], "app.tsuzuki.mangaall")
        self.assertEqual(manifest["version"]["code"], 10)
        if manifest["publication"] == "development":
            self.assertEqual(manifest["version"]["name"], "0.5.5-dev")
            self.assertFalse((ROOT / REVIEW_FILE).exists())
            self.skipTest("MangaALL code10 remains development on original main")
        self.assertEqual(manifest["publication"], "release")
        self.assertEqual(manifest["version"]["name"], "0.5.5")
        lock = json.loads((ROOT / REVIEW_FILE).read_text(encoding="utf-8"))
        self.assertEqual(lock, {
            "reviewStatus": "approved",
            "versionCode": 10,
            "versionName": "0.5.5",
            "artifactSha256": SHA,
            "priorSequence": 35,
            "priorCode9Sha256": PRIOR_SHA,
        }, "operator approval must match the complete, immutable reviewed descriptor")

        protected = (
            "dist/providers/app.tsuzuki.mangaall-9.tsz",
            "dist/index.json",
            "dist/index.payload.json",
            "repository/config.json",
            "repository/public-key.pem",
            "providers/mangaall/manifest.json",
            REVIEW_FILE,
        )
        before = {str(p): digest(ROOT / p) for p in protected}
        self.assertEqual(before["dist/providers/app.tsuzuki.mangaall-9.tsz"], PRIOR_SHA)
        ledger = json.loads((ROOT / "dist/index.payload.json").read_text())
        self.assertEqual(ledger["sequence"], 35)
        self.assertEqual(
            next(entry for entry in ledger["providers"]
                 if entry["providerId"] == "app.tsuzuki.mangaall")["versionCode"], 9,
        )
        self.assertEqual(
            json.loads((ROOT / "repository/config.json").read_text())["sequence"], 35,
        )
        signed = subprocess.run(
            ["node", "tooling/verify_index.mjs"],
            cwd=ROOT, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(signed.returncode, 0, signed.stderr + signed.stdout)

        with tempfile.TemporaryDirectory(prefix="mangaall-code10-approved-UNSIGNED-") as tmp:
            candidate = pathlib.Path(tmp) / "reviewed-code10.tsz"
            rebuilt = pathlib.Path(tmp) / "rebuild-code10.tsz"
            build(ROOT / "providers/mangaall", candidate)
            build(ROOT / "providers/mangaall", rebuilt)
            self.assertEqual(candidate.read_bytes(), rebuilt.read_bytes())
            self.assertEqual(digest(candidate), SHA)
            # An unapproved push event cannot sign, even when the approval
            # file itself has already passed review.
            with self.assertRaisesRegex(ValueError, "manual workflow dispatch"):
                check_code10_publication(ROOT, "push", APPROVAL, SHA)
            with self.assertRaisesRegex(ValueError, "manual workflow dispatch"):
                check_code10_publication(ROOT, "workflow_dispatch", "", SHA)
            with self.assertRaisesRegex(ValueError, "archive differs"):
                check_code10_publication(ROOT, "workflow_dispatch", APPROVAL, SHA)
            # There is no dist/providers/code10 package on the original
            # source branch. The publisher must build it, run preflight,
            # and sign only during a separate privileged Actions dispatch.
        self.assertEqual(before, {str(p): digest(ROOT / p) for p in protected})
        self.assertFalse((ROOT / "dist/providers/app.tsuzuki.mangaall-10.tsz").exists(),
                         "CI review may not write production distribution files")


if __name__ == "__main__":
    unittest.main()
