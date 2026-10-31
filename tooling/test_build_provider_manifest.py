#!/usr/bin/env python3
"""Regression: repository-only publication flags must not break Host V1 manifests."""
import json
import pathlib
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from build_provider import build


class SignedPackageManifestCompatibilityTest(unittest.TestCase):
    def test_build_strips_repository_only_publication_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            provider = root / "mangadex"
            provider.mkdir()
            manifest = {
                "manifestVersion": 1,
                "id": "app.tsuzuki.mangaall.mangadex",
                "name": "MangaAll / MangaDex",
                "version": {"name": "0.1.1", "code": 2},
                "minHostApi": 1,
                "entrypoint": "main.js",
                "capabilities": [
                    {"id": "reading.lookup", "version": 1},
                    {"id": "reading.chapters", "version": 1},
                ],
                "permissions": {
                    "network": {"origins": ["https://api.mangadex.org"], "localNetwork": False},
                    "browser": {"origins": []},
                    "storage": {"enabled": False},
                    "secrets": [],
                },
                "publication": "metadata-only",
            }
            (provider / "manifest.json").write_text(json.dumps(manifest), encoding="utf8")
            (provider / "main.js").write_text("export default {};", encoding="utf8")
            output = root / "signed.tsz"
            build(provider, output)
            with zipfile.ZipFile(output) as bundle:
                embedded = json.loads(bundle.read("manifest.json"))
                self.assertNotIn("publication", embedded)
                expected = {k: v for k, v in manifest.items() if k != "publication"}
                self.assertEqual(embedded, expected,
                    "strip only repository metadata, preserve all Host security grants")
            self.assertEqual(json.loads((provider / "manifest.json").read_text()), manifest,
                "the source manifest still controls what publisher may release")

    def test_build_keeps_unmarked_v1_manifest_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            root.joinpath("manifest.json").write_text(json.dumps({
                "manifestVersion": 1, "id": "test.provider",
                "name": "Test", "version": {"name": "1", "code": 1},
                "minHostApi": 1, "entrypoint": "main.js", "capabilities": [],
            }), encoding="utf8")
            root.joinpath("main.js").write_text("export default {};", encoding="utf8")
            output = root / "test.tsz"
            build(root, output)
            with zipfile.ZipFile(output) as bundle:
                self.assertEqual(
                    json.loads(bundle.read("manifest.json")),
                    json.loads(root.joinpath("manifest.json").read_text()),
                )


if __name__ == "__main__":
    unittest.main()
