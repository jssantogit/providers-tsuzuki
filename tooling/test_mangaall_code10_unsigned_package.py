"""Offline code10 package integrity, never a release or signing authorization.

The historical 0.5.4/code9 archive remains immutable, while the official
signed P-256 publication is now 0.5.5/code10 sequence36. Rebuilding uses
temporary files only; never signs or publishes anything.
"""
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
CODE9_SHA = "d9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622"
CODE10_SHA = "bcdfd03ac18c3cfdd0517e08b58dde7efa1f5baa874e93002af28e518860f95f"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class MangaAllCode10UnsignedPackageTest(unittest.TestCase):
    def test_dev_package_is_reproducible_and_cannot_replace_signed_code9(self):
        source = json.loads((ROOT / "providers/mangaall/manifest.json").read_text())
        self.assertEqual(source["id"], "app.tsuzuki.mangaall")
        self.assertEqual(source["version"]["code"], 10)
        self.assertIn(
            (source["version"]["name"], source["publication"]),
            {("0.5.5-dev", "development"), ("0.5.5", "release")},
            "only the development branch or unapproved release review branch is eligible",
        )
        review_file = ROOT / "review/mangaall-code10/approved-artifact.json"
        self.assertEqual(review_file.exists(), source["publication"] == "release")
        if review_file.exists():
            review = json.loads(review_file.read_text())
            self.assertEqual(review["reviewStatus"], "approved")
            self.assertEqual(review["versionCode"], 10)

        historical_path = ROOT / "dist/providers/app.tsuzuki.mangaall-9.tsz"
        published_path = ROOT / "dist/providers/app.tsuzuki.mangaall-10.tsz"
        ledger = ROOT / "dist/index.payload.json"
        signed_index = ROOT / "dist/index.json"
        config = ROOT / "repository/config.json"
        before = {str(p): digest(p) for p in (
            historical_path, published_path, ledger, signed_index, config,
        )}
        self.assertEqual(before[str(historical_path)], CODE9_SHA)
        self.assertEqual(before[str(published_path)], CODE10_SHA)
        index = json.loads(ledger.read_text())
        self.assertEqual(index["sequence"], 36)
        entries = [x for x in index["providers"] if x["providerId"] == source["id"]]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["versionCode"], 10)
        self.assertEqual(entries[0]["versionName"], "0.5.5")
        self.assertEqual(entries[0]["sha256"], CODE10_SHA)

        # Verify the actual pinned P-256 index, not only a self-reported hash.
        checked = subprocess.run(
            ["node", "tooling/verify_index.mjs"], cwd=ROOT,
            capture_output=True, text=True, timeout=30, check=False,
        )
        self.assertEqual(checked.returncode, 0, checked.stdout + "\n" + checked.stderr)

        with tempfile.TemporaryDirectory(prefix="mangaall-code10-dev-only-") as tmp:
            archives = [pathlib.Path(tmp) / f"candidate-{i}.tsz" for i in (1, 2)]
            for archive in archives:
                built = subprocess.run(
                    [sys.executable, "tooling/build_provider.py", "providers/mangaall", str(archive)],
                    cwd=ROOT, capture_output=True, text=True, check=False, timeout=30,
                )
                self.assertEqual(built.returncode, 0, built.stdout + "\n" + built.stderr)
            self.assertEqual(archives[0].read_bytes(), archives[1].read_bytes(),
                             "a reviewed future package must build deterministically")
            self.assertNotEqual(digest(archives[0]), CODE9_SHA,
                                "code10 may never impersonate the signed code9")
            if source["publication"] == "release":
                self.assertEqual(digest(archives[0]), CODE10_SHA,
                                 "published code10 must reproduce exact signed archive")
                self.assertEqual(archives[0].read_bytes(), published_path.read_bytes())
            with zipfile.ZipFile(historical_path) as published, zipfile.ZipFile(archives[0]) as candidate:
                old_manifest = json.loads(published.read("manifest.json"))
                new_manifest = json.loads(candidate.read("manifest.json"))
                self.assertEqual(old_manifest["version"], {"name": "0.5.4", "code": 9})
                self.assertEqual(new_manifest["version"], source["version"])
                self.assertNotIn("publication", new_manifest)
                for unchanged in ("id", "name", "minHostApi", "entrypoint",
                                  "capabilities", "permissions", "contentLanguages"):
                    self.assertEqual(new_manifest[unchanged], old_manifest[unchanged],
                                     f"candidate cannot silently broaden {unchanged}")
                self.assertIn(b"MAX_COVERAGE_PAGES = 2", candidate.read(
                    "modules/sources/mangadex/modules/mangadex.js"))
                self.assertIn(b"COVERAGE_PAGE_SIZE = 12", candidate.read(
                    "modules/sources/mangadex/modules/mangadex.js"))
                self.assertIn(b"deferredLookupState", candidate.read("modules/router.js"))
                self.assertIn(b"tokenKey = Symbol", candidate.read("modules/v2-candidate.js"))
                for member in candidate.namelist():
                    self.assertFalse(member.endswith((".pem", ".key", ".sig")),
                                     "never package private/signing material")
                self.assertFalse(any("code10" in p for p in published.namelist()),
                                 "signed code9 must remain historical")

        self.assertEqual(before, {path: digest(pathlib.Path(path)) for path in before},
                         "build/review must not mutate signed package, root, sequence or index")

    def test_code10_release_is_not_approved_by_historical_code9_gate(self):
        from mangaall_code9_publication_gate import check_code9_publication
        source = json.loads((ROOT / "providers/mangaall/manifest.json").read_text())
        # Code10 is ALREADY the signed release. The historical code9 gate
        # must be inert for both a push and an old code9 manual token;
        # it must never return authorization to sign again.
        for event, token in (
            ("push", ""), ("workflow_dispatch", "PUBLISH_MANGAALL_CODE9"),
        ):
            with self.subTest(event=event):
                self.assertEqual(
                    check_code9_publication(ROOT, event, token),
                    "NO_CODE9_PROMOTION",
                )


if __name__ == "__main__":
    unittest.main()
