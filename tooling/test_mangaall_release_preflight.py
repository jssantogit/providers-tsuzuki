#!/usr/bin/env python3
"""Mutation tests for the exact single-provider release delta. No private key."""
import copy
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from mangaall_release_preflight import (  # noqa: E402
    CODE6_SHA256,
    CODE7_SHA256,
    PreflightError,
    assert_index_delta,
    assert_manifest_upgrade,
)


class MangaAllReleasePreflightTest(unittest.TestCase):
    def setUp(self):
        self.published = {
            "id": "app.tsuzuki.mangaall",
            "name": "MangaAll",
            "version": {"name": "0.5.1", "code": 6},
            "minHostApi": 1,
            "entrypoint": "main.js",
            "capabilities": [
                {"id": "reading.lookup", "version": 1},
                {"id": "reading.chapters", "version": 1},
                {"id": "reading.pages", "version": 1},
            ],
            "permissions": {
                "network": {"origins": ["https://mangafire.to"], "localNetwork": False},
                "browser": {"origins": ["https://mangafire.to"]},
                "storage": {"enabled": False},
                "secrets": [],
            },
            "contentLanguages": ["en", "pt-br"],
            "settings": [],
            "publication": "preview",
        }
        self.candidate = copy.deepcopy(self.published)
        self.candidate["version"] = {"name": "0.5.2", "code": 7}
        self.other = {
            "providerId": "app.tsuzuki.mangafire",
            "versionName": "0.1.12",
            "versionCode": 13,
            "artifactUrl": "https://example.net/app.tsuzuki.mangafire-13.tsz",
            "sha256": "1" * 64,
            "minHostApi": 1,
        }
        self.code6 = {
            "providerId": "app.tsuzuki.mangaall",
            "versionName": "0.5.1",
            "versionCode": 6,
            "artifactUrl": "https://example.net/app.tsuzuki.mangaall-6.tsz",
            "sha256": CODE6_SHA256,
            "minHostApi": 1,
        }
        self.before = {
            "schemaVersion": 1,
            "repositoryId": "app.tsuzuki.providers",
            "sequence": 32,
            "providers": [self.code6, self.other],
            "revokedArtifactSha256": [],
            "nextSigningKey": None,
        }
        self.after = copy.deepcopy(self.before)
        self.after["sequence"] = 33
        upgraded = self.after["providers"][0]
        upgraded["versionName"] = "0.5.2"
        upgraded["versionCode"] = 7
        upgraded["artifactUrl"] = upgraded["artifactUrl"].replace("-6.tsz", "-7.tsz")
        upgraded["sha256"] = CODE7_SHA256

    def test_only_authorized_code6_to_code7_manifest_change_is_accepted(self):
        assert_manifest_upgrade(self.published, self.candidate)

    def test_id_change_cannot_publish_a_second_provider(self):
        self.candidate["id"] = "app.tsuzuki.mangaall.smoke.v7"
        with self.assertRaisesRegex(PreflightError, "single official Provider ID"):
            assert_manifest_upgrade(self.published, self.candidate)

    def test_same_code_or_downgrade_does_not_pass(self):
        self.candidate["version"] = {"name": "0.5.1", "code": 6}
        with self.assertRaisesRegex(PreflightError, "code7"):
            assert_manifest_upgrade(self.published, self.candidate)

    def test_network_permission_widening_is_not_silent(self):
        self.candidate["permissions"]["network"]["origins"].append("https://unexpected.example")
        with self.assertRaisesRegex(PreflightError, "stable permissions"):
            assert_manifest_upgrade(self.published, self.candidate)

    def test_browser_permission_widening_is_not_silent(self):
        self.candidate["permissions"]["browser"]["origins"].append("https://other.example")
        with self.assertRaisesRegex(PreflightError, "stable permissions"):
            assert_manifest_upgrade(self.published, self.candidate)

    def test_publication_flag_or_host_api_cannot_change(self):
        self.candidate["publication"] = "development"
        with self.assertRaisesRegex(PreflightError, "publication policy"):
            assert_manifest_upgrade(self.published, self.candidate)
        self.candidate["publication"] = "preview"
        self.candidate["minHostApi"] = 2
        with self.assertRaisesRegex(PreflightError, "stable permissions"):
            assert_manifest_upgrade(self.published, self.candidate)

    def test_valid_index_plan_has_one_provider_update(self):
        assert_index_delta(self.before, self.after, CODE7_SHA256)

    def test_unrelated_provider_change_is_not_signed_accidentally(self):
        self.after["providers"][1]["versionCode"] = 14
        with self.assertRaisesRegex(PreflightError, "Unrelated Provider"):
            assert_index_delta(self.before, self.after, CODE7_SHA256)

    def test_index_cannot_add_a_separate_mangaall_adapter(self):
        self.after["providers"].append({
            **self.other, "providerId": "app.tsuzuki.mangaall.mangadex",
        })
        with self.assertRaisesRegex(PreflightError, "add or retire"):
            assert_index_delta(self.before, self.after, CODE7_SHA256)

    def test_index_rejects_duplicate_provider(self):
        self.after["providers"].append(copy.deepcopy(self.other))
        with self.assertRaisesRegex(PreflightError, "Duplicate"):
            assert_index_delta(self.before, self.after, CODE7_SHA256)

    def test_index_must_advance_exactly_one_sequence(self):
        self.after["sequence"] = 34
        with self.assertRaisesRegex(PreflightError, "32 to 33"):
            assert_index_delta(self.before, self.after, CODE7_SHA256)

    def test_index_cannot_rotate_root_or_modify_revocations(self):
        self.after["nextSigningKey"] = {"keyId": "surprise-key"}
        with self.assertRaisesRegex(PreflightError, "rotate"):
            assert_index_delta(self.before, self.after, CODE7_SHA256)
        self.after["nextSigningKey"] = None
        self.after["revokedArtifactSha256"].append("0" * 64)
        with self.assertRaisesRegex(PreflightError, "revocations"):
            assert_index_delta(self.before, self.after, CODE7_SHA256)

    def test_index_must_use_exact_original_code7_archive_digest(self):
        self.after["providers"][0]["sha256"] = "f" * 64
        with self.assertRaisesRegex(PreflightError, "exactly code7"):
            assert_index_delta(self.before, self.after, CODE7_SHA256)

    def test_original_signed_code6_is_not_mutable(self):
        self.before["providers"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(PreflightError, "audited baseline"):
            assert_index_delta(self.before, self.after, CODE7_SHA256)


if __name__ == "__main__":
    unittest.main()
