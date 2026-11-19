#!/usr/bin/env python3
"""Offline adversarial tests: no secret, signing, network, or publication."""
import hashlib
import json
import pathlib
import tempfile
import unittest

from build_provider import build
from mangaall_code9_publication_gate import check_code9_publication


class MangaAllCode9PublicationGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.provider = self.root / "providers/mangaall"
        for path in ("repository", "dist/providers", "providers/mangaall/modules"):
            (self.root / path).mkdir(parents=True)
        self.code8 = b"immutable-published-code8-test-only"
        (self.root / "dist/providers/app.tsuzuki.mangaall-8.tsz").write_bytes(self.code8)
        self.write("repository/config.json", {
            "repositoryId": "app.tsuzuki.providers", "sequence": 34,
            "keyId": "tsuzuki-provider-root-2026-02",
        })
        self.write("dist/index.payload.json", {
            "repositoryId": "app.tsuzuki.providers", "sequence": 34,
            "providers": [{
                "providerId": "app.tsuzuki.mangaall", "versionCode": 8,
                "versionName": "0.5.3", "sha256": hashlib.sha256(self.code8).hexdigest(),
            }],
        })
        self.manifest(8, "0.5.3", None)
        (self.provider / "main.js").write_text(
            'import { createMangaAllLookupV2Candidate } from "./modules/v2-candidate.js";\n'
            'export default {reading: createMangaAllLookupV2Candidate({})};\n', encoding="utf8",
        )
        (self.provider / "modules/v2-candidate.js").write_text(
            "export function createMangaAllLookupV2Candidate() { return {}; }\n", encoding="utf8",
        )

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value), encoding="utf8")

    def manifest(self, code, version, publication):
        value = {
            "id": "app.tsuzuki.mangaall", "version": {"code": code, "name": version},
            "entrypoint": "main.js", "minHostApi": 1,
        }
        if publication is not None:
            value["publication"] = publication
        self.write("providers/mangaall/manifest.json", value)

    def check(self, event="workflow_dispatch", approval="PUBLISH_MANGAALL_CODE9"):
        return check_code9_publication(self.root, event, approval)

    def build_code9(self):
        build(self.provider, self.root / "dist/providers/app.tsuzuki.mangaall-9.tsz")

    def test_published_code8_is_untouched(self):
        self.assertEqual(self.check(), "NO_CODE9_PROMOTION")

    def test_code9_development_is_not_a_release(self):
        self.manifest(9, "0.5.4-dev-unsigned", "development")
        self.assertEqual(self.check(), "STAGED_ONLY")

    def test_code9_requires_manual_dispatch(self):
        self.manifest(9, "0.5.4", "release")
        with self.assertRaisesRegex(ValueError, "manual dispatch"):
            self.check("push")
        with self.assertRaisesRegex(ValueError, "operator authorization"):
            self.check("workflow_dispatch", "")

    def test_code9_dev_version_and_implicit_release_are_denied(self):
        self.manifest(9, "0.5.4", None)
        with self.assertRaisesRegex(ValueError, "publication=release"):
            self.check()
        self.manifest(9, "0.5.4-dev-unsigned", "release")
        with self.assertRaisesRegex(ValueError, "reviewed version"):
            self.check()

    def test_code10_is_not_implicitly_authorized(self):
        self.manifest(10, "0.5.5", "release")
        with self.assertRaisesRegex(ValueError, "Code10"):
            self.check()

    def test_code9_rejects_implicit_signing_root_rotation(self):
        self.manifest(9, "0.5.4", "release")
        config = json.loads((self.root / "repository/config.json").read_text())
        config["keyId"] = "unexpected-root"
        self.write("repository/config.json", config)
        with self.assertRaisesRegex(ValueError, "signing-root rotation"):
            self.check()

    def test_code9_rejects_tampered_previous_artifact(self):
        self.manifest(9, "0.5.4", "release")
        (self.root / "dist/providers/app.tsuzuki.mangaall-8.tsz").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "code8 archive"):
            self.check()

    def test_code9_rejects_experimental_provenance(self):
        self.manifest(9, "0.5.4", "release")
        (self.provider / "modules/v2-candidate.js").write_text(
            'export const provenance = "UNSIGNED_CANDIDATE_NOT_LIVE";\n', encoding="utf8",
        )
        with self.assertRaisesRegex(ValueError, "unsigned provenance"):
            self.check()

    def test_code9_rejects_mismatched_artifact(self):
        self.manifest(9, "0.5.4", "release")
        self.build_code9()
        (self.root / "dist/providers/app.tsuzuki.mangaall-9.tsz").write_bytes(b"substituted")
        with self.assertRaisesRegex(ValueError, "differs from deterministic"):
            self.check()

    def test_approved_first_release_passes_only_preflight(self):
        self.manifest(9, "0.5.4", "release")
        self.build_code9()
        self.assertEqual(self.check(), "AUTHORIZED_PREFLIGHT_ONLY_NOT_SIGNED")

    def test_already_published_code9_does_not_block_unrelated_release(self):
        self.manifest(9, "0.5.4", "release")
        self.build_code9()
        payload = json.loads((self.root / "dist/index.payload.json").read_text())
        payload["providers"][0]["versionCode"] = 9
        payload["providers"][0]["versionName"] = "0.5.4"
        payload["providers"][0]["sha256"] = hashlib.sha256(
            (self.root / "dist/providers/app.tsuzuki.mangaall-9.tsz").read_bytes()
        ).hexdigest()
        self.write("dist/index.payload.json", payload)
        self.assertEqual(self.check("push", ""), "NO_CODE9_PROMOTION")


if __name__ == "__main__":
    unittest.main()
