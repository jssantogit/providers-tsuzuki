"""Proof that an unmerged code10 promotion PR remains unapproved and UNSIGNED.

These checks use the exact real source bytes, the signed code9 baseline, and
the independently archived candidate SHA. Nothing signs or publishes.
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
CANDIDATE = ROOT / "review/mangaall-code10/promotion-candidate-unapproved.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Code10UnmergedPromotionReview(unittest.TestCase):
    def test_unapproved_release_branch_has_no_signing_authorization(self):
        manifest = json.loads((ROOT / "providers/mangaall/manifest.json").read_text())
        self.assertEqual(manifest["id"], "app.tsuzuki.mangaall")
        self.assertEqual(manifest["version"]["code"], 10)
        self.assertIn(
            (manifest["version"]["name"], manifest["publication"]),
            {("0.5.5-dev", "development"), ("0.5.5", "release")},
        )
        if manifest["publication"] != "release":
            self.skipTest("main is still development; staging review is only for release PR")
        self.assertFalse((ROOT / REVIEW_FILE).exists(),
                         "ONLY the future independent operator approval may create a review lock")
        self.assertTrue(CANDIDATE.is_file())
        record = json.loads(CANDIDATE.read_text())
        self.assertEqual(record, {
            "reviewStatus": "candidate_unapproved",
            "providerId": "app.tsuzuki.mangaall",
            "versionCode": 10, "versionName": "0.5.5",
            "artifactSha256": "776d0e8bd64897c30283cad29f1aa331c86dac638deac1f106f042768167b94d",
            "independentSourceReview": "pending",
            "priorSequence": 35, "priorCode9Sha256": PRIOR_SHA,
            "signed": False, "published": False,
        })
        before = {
            str(p): digest(ROOT / p)
            for p in (
                "dist/providers/app.tsuzuki.mangaall-9.tsz",
                "dist/index.json",
                "dist/index.payload.json",
                "repository/config.json",
                "repository/public-key.pem",
                "providers/mangaall/manifest.json",
            )
        }
        self.assertEqual(before["dist/providers/app.tsuzuki.mangaall-9.tsz"], PRIOR_SHA)
        ledger = json.loads((ROOT / "dist/index.payload.json").read_text())
        self.assertEqual(ledger["sequence"], 35)
        self.assertEqual(
            next(x for x in ledger["providers"]
                 if x["providerId"] == "app.tsuzuki.mangaall")["versionCode"], 9,
        )
        self.assertEqual(
            json.loads((ROOT / "repository/config.json").read_text())["sequence"], 35,
        )
        signed = subprocess.run(["node", "tooling/verify_index.mjs"], cwd=ROOT,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(signed.returncode, 0, signed.stderr + signed.stdout)

        with tempfile.TemporaryDirectory(prefix="mangaall-code10-promotion-UNSIGNED-") as tmp:
            candidate = pathlib.Path(tmp) / "candidate.ts z".replace(" ", "")
            build(ROOT / "providers/mangaall", candidate)
            self.assertEqual(digest(candidate), record["artifactSha256"],
                             "final package bytes must be EXACTLY those independently reviewed")
            with self.assertRaisesRegex(ValueError, "manual workflow dispatch"):
                check_code10_publication(ROOT, "push", APPROVAL, record["artifactSha256"])
            with self.assertRaisesRegex(ValueError, "independently reviewed artifact lock"):
                check_code10_publication(
                    ROOT, "workflow_dispatch", APPROVAL, record["artifactSha256"],
                )
        self.assertEqual(
            before, {str(p): digest(ROOT / p) for p in before},
            "candidate build or gate must not modify the actual signed repository snapshot",
        )
        self.assertFalse((ROOT / REVIEW_FILE).exists())


if __name__ == "__main__":
    unittest.main()
