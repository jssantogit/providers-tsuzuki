import hashlib
import json
import pathlib
import tempfile
import unittest

from prepare_publication import prepare_publication


class PublicationPlanningTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        for part in ("repository", "dist/providers", "providers/mangafire", "providers/nyaa"):
            (self.root / part).mkdir(parents=True, exist_ok=True)
        self.write("repository/config.json", {"repositoryId": "app.tsuzuki.providers", "keyId": "tsuzuki-provider-root-2026-02", "sequence": 24})
        self.write("dist/index.payload.json", {"repositoryId": "app.tsuzuki.providers", "sequence": 24, "providers": [
            self.desc("app.tsuzuki.mangafire", 7, "0.1.6", b"old"),
            self.desc("app.tsuzuki.nyaa", 15, "0.1.14", b"nyaa"),
        ]})
        self.write("providers/mangafire/manifest.json", {"id": "app.tsuzuki.mangafire", "version": {"code": 7, "name": "0.1.6"}})
        self.write("providers/nyaa/manifest.json", {"id": "app.tsuzuki.nyaa", "version": {"code": 15, "name": "0.1.14"}})
        (self.root / "dist/providers/app.tsuzuki.mangafire-7.tsz").write_bytes(b"old")
        (self.root / "dist/providers/app.tsuzuki.nyaa-15.tsz").write_bytes(b"nyaa")

    @staticmethod
    def desc(provider_id, code, name, payload):
        return {"providerId": provider_id, "versionCode": code, "versionName": name,
                "sha256": hashlib.sha256(payload).hexdigest()}

    def write(self, path, value):
        (self.root / path).write_text(json.dumps(value), encoding="utf8")

    def current_sequence(self):
        return json.loads((self.root / "repository/config.json").read_text())["sequence"]

    def upgrade(self):
        self.write("providers/mangafire/manifest.json", {"id": "app.tsuzuki.mangafire", "version": {"code": 8, "name": "0.1.7"}})
        (self.root / "dist/providers/app.tsuzuki.mangafire-8.tsz").write_bytes(b"new")

    def test_no_changes_do_not_increment_or_re_sign(self):
        self.assertFalse(prepare_publication(self.root))
        self.assertEqual(self.current_sequence(), 24)

    def test_new_version_increments_sequence_once_and_keeps_published_artifacts(self):
        self.upgrade()
        self.assertTrue(prepare_publication(self.root))
        self.assertEqual(self.current_sequence(), 25)
        self.assertTrue((self.root / "dist/providers/app.tsuzuki.mangafire-7.tsz").is_file())
        self.assertTrue((self.root / "dist/providers/app.tsuzuki.nyaa-15.tsz").is_file())

    def test_same_code_with_different_bytes_rejected(self):
        (self.root / "dist/providers/app.tsuzuki.mangafire-7.tsz").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "immutable"):
            prepare_publication(self.root)
        self.assertEqual(self.current_sequence(), 24)

    def test_downgrade_rejected(self):
        self.write("providers/mangafire/manifest.json", {"id": "app.tsuzuki.mangafire", "version": {"code": 6, "name": "0.1.5"}})
        (self.root / "dist/providers/app.tsuzuki.mangafire-6.tsz").write_bytes(b"old-old")
        with self.assertRaisesRegex(ValueError, "downgrade"):
            prepare_publication(self.root)

    def test_config_cannot_diverge_from_existing_signed_index(self):
        cfg = json.loads((self.root / "repository/config.json").read_text())
        cfg["sequence"] = 25
        self.write("repository/config.json", cfg)
        self.upgrade()
        with self.assertRaisesRegex(ValueError, "signed sequence"):
            prepare_publication(self.root)

    def test_missing_published_provider_rejected(self):
        (self.root / "providers/nyaa/manifest.json").unlink()
        with self.assertRaisesRegex(ValueError, "missing published"):
            prepare_publication(self.root)

    def test_development_provider_not_promoted(self):
        (self.root / "providers/mangaall-ball").mkdir(parents=True, exist_ok=True)
        self.write("providers/mangaall-ball/manifest.json", {"id": "app.tsuzuki.mangaall.ball", "version": {"code": 1, "name": "0.1.0"}, "publication": "development"})
        self.assertFalse(prepare_publication(self.root))


if __name__ == "__main__":
    unittest.main()
