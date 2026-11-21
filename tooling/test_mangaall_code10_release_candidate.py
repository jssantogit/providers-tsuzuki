"""Offline candidate builder tests: never create an approved review lock."""
import hashlib
import json
import pathlib
import tempfile
import unittest
import zipfile

from mangaall_code10_release_candidate import ROOT, OLD_SHA, prepare_candidate


class Code10ReviewCandidateTest(unittest.TestCase):
    def test_prepares_exact_unsigned_package_and_no_review_authorization(self):
        with tempfile.TemporaryDirectory(prefix="mangaall-code10-review-fixture-") as folder:
            output = pathlib.Path(folder) / "unsigned"
            report = prepare_candidate(output, source_commit="a" * 40)
            archive = output / "app.tsuzuki.mangaall-10.tsz"
            on_disk = json.loads((output / "candidate-review.json").read_text())
            self.assertEqual(report, on_disk)
            self.assertEqual(
                report["reviewStatus"],
                "approved_for_manual_dispatch_not_signed"
                if (ROOT / "review/mangaall-code10/approved-artifact.json").exists()
                else "candidate_unapproved",
            )
            self.assertEqual(report["sourceCommit"], "a" * 40)
            self.assertEqual(report["versionCode"], 10)
            self.assertEqual(report["versionName"], "0.5.5")
            self.assertEqual(report["priorSequence"], 35)
            self.assertEqual(report["priorCode9Sha256"], OLD_SHA)
            self.assertEqual(report["artifactSha256"], hashlib.sha256(archive.read_bytes()).hexdigest())
            self.assertFalse(report["signed"])
            self.assertFalse(report["published"])
            with zipfile.ZipFile(archive) as source:
                manifest = json.loads(source.read("manifest.json"))
                self.assertEqual(manifest["version"], {"name": "0.5.5", "code": 10})
                self.assertNotIn("publication", manifest)
                self.assertIn("modules/router.js", source.namelist())
            # A candidate's metadata MUST NOT satisfy the code10 gate.
            self.assertNotIn("approved", output.joinpath("candidate-review.json").name)
            lock_file = ROOT / "review/mangaall-code10/approved-artifact.json"
            source = json.loads((ROOT / "providers/mangaall/manifest.json").read_text())
            self.assertEqual(lock_file.exists(), source["publication"] == "release")
            if lock_file.exists():
                approved = json.loads(lock_file.read_text())
                self.assertEqual(approved["artifactSha256"], report["artifactSha256"])
                self.assertEqual(approved["reviewStatus"], "approved")
            self.assertIn((source["version"]["name"], source["publication"]), {
                ("0.5.5-dev", "development"), ("0.5.5", "release"),
            })
            # Never overwrite an already materialized review candidate.
            with self.assertRaisesRegex(ValueError, "Refusing to overwrite"):
                prepare_candidate(output, source_commit="a" * 40)

    def test_refuses_to_put_prepared_release_into_source_tree(self):
        with self.assertRaisesRegex(ValueError, "OUTSIDE"):
            prepare_candidate(ROOT / "dist/providers")
        with self.assertRaisesRegex(ValueError, "OUTSIDE"):
            prepare_candidate(ROOT)

    def test_refuses_unknown_dev_version_before_any_publication_check(self):
        with tempfile.TemporaryDirectory(prefix="mangaall-fake-root-") as tmp:
            root = pathlib.Path(tmp)
            manifest = root / "providers/mangaall/manifest.json"
            manifest.parent.mkdir(parents=True)
            for value in (
                {"id": "app.tsuzuki.mangaall", "version": {"name": "0.5.6", "code": 10},
                 "publication": "release"},
                {"id": "app.tsuzuki.mangaall", "version": {"name": "0.5.5-dev", "code": 9},
                 "publication": "development"},
                {"id": "app.malicious", "version": {"name": "0.5.5-dev", "code": 10},
                 "publication": "development"},
            ):
                manifest.write_text(json.dumps(value))
                with self.subTest(value=value), self.assertRaisesRegex(ValueError, "Cannot prepare"):
                    prepare_candidate(root.parent / "review-out", source_root=root)


if __name__ == "__main__":
    unittest.main()
