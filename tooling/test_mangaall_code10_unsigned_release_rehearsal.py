"""Disposable end-to-end *unsigned* code10 release planning rehearsal.

This runs the real publication planner and index payload builder only in a
temporary copy; no private key, signing, upload, workflow dispatch or git push.
A synthetic review lock used here is a test fixture, NEVER operator approval.
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

from build_provider import build
from mangaall_code10_publication_gate import APPROVAL, PRIOR_SHA, REVIEW_FILE, check_code10_publication
from prepare_publication import prepare_publication

ROOT = pathlib.Path(__file__).resolve().parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class MangaAllCode10DisposablePublicationTest(unittest.TestCase):
    def test_full_planner_would_reserve_sequence36_without_touching_signed_seq35(self):
        protected = (
            "repository/config.json",
            "dist/index.payload.json",
            "dist/index.json",
            "dist/providers/app.tsuzuki.mangaall-9.tsz",
            "providers/mangaall/manifest.json",
            ".github/workflows/publish.yml",
        )
        before = {path: sha(ROOT / path) for path in protected}
        self.assertEqual(before["dist/providers/app.tsuzuki.mangaall-9.tsz"], PRIOR_SHA)
        real_review = ROOT / REVIEW_FILE
        if real_review.exists():
            recorded = json.loads(real_review.read_text())
            self.assertEqual(recorded["reviewStatus"], "approved")
            self.assertEqual(recorded["versionCode"], 10)
            self.assertEqual(recorded["priorSequence"], 35)
            self.assertEqual(recorded["priorCode9Sha256"], PRIOR_SHA)

        with tempfile.TemporaryDirectory(prefix="mangaall-code10-UNSIGNED-dry-run-") as tmp:
            sandbox = pathlib.Path(tmp)
            for directory in ("providers", "repository", "dist"):
                shutil.copytree(ROOT / directory, sandbox / directory)
            (sandbox / "tooling").mkdir()
            shutil.copyfile(ROOT / "tooling/verify_index.mjs",
                            sandbox / "tooling/verify_index.mjs")
            old_config = json.loads((sandbox / "repository/config.json").read_text())
            old_index = json.loads((sandbox / "dist/index.payload.json").read_text())
            prior_signature_sha = sha(sandbox / "dist/index.json")
            self.assertEqual(old_index["sequence"], 35)
            self.assertEqual(old_config["sequence"], 35)

            manifest_path = sandbox / "providers/mangaall/manifest.json"
            manifest = json.loads(manifest_path.read_text())
            self.assertIn(
                (manifest["version"]["name"], manifest["publication"]),
                {("0.5.5-dev", "development"), ("0.5.5", "release")},
            )
            manifest["publication"] = "release"     # TEST COPY ONLY
            manifest["version"]["name"] = "0.5.5"  # TEST COPY ONLY
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            archive = sandbox / "dist/providers/app.tsuzuki.mangaall-10.tsz"
            build(sandbox / "providers/mangaall", archive)
            candidate_sha = sha(archive)
            self.assertNotEqual(candidate_sha, PRIOR_SHA)

            # Only this disposable sandbox contains a positive synthetic
            # lock so the otherwise unreachable approved branch is tested.
            fixture_lock = sandbox / REVIEW_FILE
            fixture_lock.parent.mkdir(parents=True, exist_ok=True)
            fixture_lock.write_text(json.dumps({
                "reviewStatus": "approved", "versionCode": 10,
                "versionName": "0.5.5", "artifactSha256": candidate_sha,
                "priorSequence": 35, "priorCode9Sha256": PRIOR_SHA,
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "manual workflow dispatch"):
                check_code10_publication(sandbox, "push", APPROVAL, candidate_sha)
            with self.assertRaisesRegex(ValueError, "manual workflow dispatch"):
                check_code10_publication(sandbox, "workflow_dispatch", "", candidate_sha)
            self.assertEqual(
                check_code10_publication(sandbox, "workflow_dispatch", APPROVAL, candidate_sha),
                "AUTHORIZED_CODE10_PREFLIGHT_ONLY_NOT_SIGNED",
                "positive preflight still cannot sign an unsigned planned index",
            )
            self.assertTrue(prepare_publication(sandbox))
            self.assertEqual(json.loads((sandbox / "repository/config.json").read_text())["sequence"], 36)
            built = subprocess.run(
                ["node", str(ROOT / "tooling/build_index.mjs")], cwd=sandbox,
                capture_output=True, text=True, check=False, timeout=30,
            )
            self.assertEqual(built.returncode, 0, built.stdout + "\n" + built.stderr)
            next_index = json.loads((sandbox / "dist/index.payload.json").read_text())
            self.assertEqual(next_index["sequence"], 36)
            previous_by_id = {row["providerId"]: row for row in old_index["providers"]}
            next_by_id = {row["providerId"]: row for row in next_index["providers"]}
            self.assertEqual(previous_by_id.keys(), next_by_id.keys(),
                             "no other Provider may disappear from the signed catalog")
            for provider_id, original in previous_by_id.items():
                if provider_id != "app.tsuzuki.mangaall":
                    self.assertEqual(next_by_id[provider_id], original,
                                     "other installed Provider descriptors remain unchanged")
            manga = next_by_id["app.tsuzuki.mangaall"]
            self.assertEqual(manga["versionCode"], 10)
            self.assertEqual(manga["versionName"], "0.5.5")
            self.assertEqual(manga["sha256"], candidate_sha)
            self.assertTrue(manga["artifactUrl"].endswith("app.tsuzuki.mangaall-10.tsz"))
            self.assertEqual(sha(sandbox / "dist/index.json"), prior_signature_sha,
                             "old signed envelope may not be rewritten by unsigned planning")
            self.assertEqual(sha(sandbox / "dist/providers/app.tsuzuki.mangaall-9.tsz"), PRIOR_SHA)
            failed_signature = subprocess.run(
                ["node", str(ROOT / "tooling/verify_index.mjs")], cwd=sandbox,
                capture_output=True, text=True, check=False, timeout=30,
            )
            self.assertNotEqual(failed_signature.returncode, 0,
                                "seq36 payload without a NEW P-256 signature is not published")

        self.assertEqual(before, {path: sha(ROOT / path) for path in protected},
                         "disposable rehearsal cannot modify any actual source or signed artifact")
        self.assertEqual((ROOT / REVIEW_FILE).exists(), real_review.exists(),
                         "disposable rehearsal must preserve the original operator approval state")


if __name__ == "__main__":
    unittest.main()
