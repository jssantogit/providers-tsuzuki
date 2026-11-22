"""Research-only MangaALL future code11 ZIP generator regression (never releases)."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tooling"))
from build_provider import package_files  # noqa: E402
from mangaall_future_code11_candidate import unsigned_candidate_zip  # noqa: E402


class FutureCode11SourceStagingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.zip_bytes = unsigned_candidate_zip(ROOT)

    def test_immutable_three_source_router_and_original_code10_source(self):
        source = ROOT / "providers" / "mangaall"
        _, original = package_files(source)
        original = {name: file.read_bytes() for name, file in original}
        self.assertEqual(json.loads(original["manifest.json"])["version"]["code"], 10)
        self.assertEqual(
            (ROOT / "providers/mangaall/manifest.json").read_bytes(),
            original["manifest.json"],
        )
        with zipfile.ZipFile(io.BytesIO(self.zip_bytes)) as z:
            self.assertEqual(z.testzip(), None)
            self.assertEqual(len(z.namelist()), len(original) + 2)
            for name, content in original.items():
                if name in ("manifest.json", "main.js"):
                    continue
                self.assertEqual(z.read(name), content, "unrelated original source changed: " + name)
            js = z.read("main.js")
            self.assertEqual(js.count(b'from "./modules/sources/mangadot/future-main.js";'), 1)
            self.assertNotIn(b'from "./modules/sources/mangadot/main.js";', js)
            self.assertIn(
                b'import mangaDex from "./modules/sources/mangadex/main.js";', js
            )
            self.assertIn(
                b'import mangaFire from "./modules/sources/mangafire/main.js";', js
            )
            self.assertEqual(z.read("modules/router.js"), original["modules/router.js"])
            self.assertEqual(
                z.read("modules/sources/mangadot/modules/mangadot.js"),
                original["modules/sources/mangadot/modules/mangadot.js"],
            )

    def test_manifest_permission_is_future_only_and_package_is_deterministic(self):
        self.assertEqual(self.zip_bytes, unsigned_candidate_zip(ROOT))
        self.assertLess(len(self.zip_bytes), 16 * 1024 * 1024)
        with zipfile.ZipFile(io.BytesIO(self.zip_bytes)) as zipf:
            manifest = json.loads(zipf.read("manifest.json"))
            self.assertEqual(manifest["id"], "app.tsuzuki.mangaall")
            self.assertEqual(manifest["version"]["code"], 11)
            self.assertEqual(manifest["minHostApi"], 2)
            self.assertNotIn("publication", manifest)
            self.assertEqual(manifest["permissions"]["mangaAllChapterSnapshot"], {"enabled": True})
            self.assertEqual(manifest["permissions"]["storage"], {"enabled": False})
            self.assertFalse(manifest["permissions"]["network"]["localNetwork"])
            self.assertIn("https://mangadot.net", manifest["permissions"]["network"]["origins"])
            self.assertEqual(
                [x["id"] for x in manifest["capabilities"]],
                ["reading.lookup", "reading.chapters", "reading.pages"],
            )
            self.assertEqual(
                zipf.read("modules/sources/mangadot/future-native-bridge.js"),
                (ROOT / "tooling/mangaall_future_native_chapter_bridge.mjs").read_bytes(),
            )
            self.assertEqual(len(set(zipf.namelist())), len(zipf.namelist()))
        digest = hashlib.sha256(self.zip_bytes).hexdigest()
        print("MANGAALL_FUTURE_CODE11|IN_MEMORY_ZIP_SHA256=" + digest +
              "|SIGNATURE=NONE|INDEX=UNCHANGED")

    def test_real_three_source_router_and_4341_native_rows_in_extracted_temporary_zip(self):
        # Extraction is test-only under an automatically deleted temp directory.
        # No package written to dist/, providers/, repository/, index or app assets.
        with tempfile.TemporaryDirectory(prefix="mangaall-unsigned-code11-") as temporary:
            stage = Path(temporary)
            with zipfile.ZipFile(io.BytesIO(self.zip_bytes)) as z:
                z.extractall(stage)
            (stage / "package.json").write_text('{"type":"module"}', encoding="utf-8")
            result = subprocess.run(
                [
                    "node",
                    str(ROOT / "tooling/test_mangaall_future_code11_real_router.mjs"),
                    str(stage),
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                timeout=45,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + "\n" + result.stderr)
            self.assertIn("REAL_THREE_SOURCE_ROUTER=PASS", result.stdout)
            self.assertIn("MANGAFIRE_403=INCONCLUSIVE", result.stdout)
            self.assertIn("NATIVE_CHAPTERS=4341", result.stdout)
            self.assertIn("SOURCE_LIST_HTTP=ZERO", result.stdout)


if __name__ == "__main__":
    unittest.main()
