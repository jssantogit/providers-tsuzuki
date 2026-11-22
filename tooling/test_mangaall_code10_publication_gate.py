"""Offline adversarial gate tests. Every approved release case is disposable.

Uses the real signed seq35 P-256 artifacts as immutable input, but NEVER
signs, uploads, dispatches a workflow, edits main, or authorizes code10.
"""
import hashlib
import json
import os
import pathlib
import shutil
import tempfile
import unittest

from build_provider import build
from mangaall_code10_publication_gate import (
    APPROVAL, PRIOR_SHA, REVIEW_FILE, check_code10_publication,
)
from mangaall_publication_gate import check_mangaall_publication

ROOT = pathlib.Path(__file__).resolve().parent.parent
HISTORICAL = pathlib.Path(os.environ.get("MANGAALL_CODE9_ORIGINAL_ROOT", ROOT)).resolve()


class Code10ReleaseGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="code10-manual-gate-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        for name in (
            "repository/config.json", "repository/public-key.pem",
            "dist/index.payload.json", "dist/index.json",
            "tooling/verify_index.mjs",
        ):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(HISTORICAL / name, dest)
        shutil.copytree(ROOT / "providers/mangaall", self.root / "providers/mangaall")
        shutil.copytree(HISTORICAL / "dist/providers", self.root / "dist/providers")
        self.source = self.root / "providers/mangaall/manifest.json"
        # Preserve the historical dev branch negative test even when the
        # source repository is an UNMERGED release-review PR: reset ONLY this
        # throwaway fixture to the development baseline.
        fixture_source = json.loads(self.source.read_text())
        if fixture_source.get("publication") == "release":
            self.assertEqual(fixture_source["version"], {"name": "0.5.5", "code": 10})
            fixture_source["publication"] = "development"
            fixture_source["version"] = {"name": "0.5.5-dev", "code": 10}
            self.source.write_text(json.dumps(fixture_source), encoding="utf-8")
        self.approval_sha = ""
        self.assertEqual(
            hashlib.sha256((self.root / "dist/providers/app.tsuzuki.mangaall-9.tsz").read_bytes()).hexdigest(),
            PRIOR_SHA,
        )

    def manifest(self, **fields):
        data = json.loads(self.source.read_text())
        data.update(fields)
        self.source.write_text(json.dumps(data), encoding="utf-8")

    def ready_release(self):
        manifest = json.loads(self.source.read_text())
        manifest["version"] = {"name": "0.5.5", "code": 10}
        manifest["publication"] = "release"
        self.source.write_text(json.dumps(manifest), encoding="utf-8")
        artifact = self.root / "dist/providers/app.tsuzuki.mangaall-10.tsz"
        build(self.root / "providers/mangaall", artifact)
        self.approval_sha = hashlib.sha256(artifact.read_bytes()).hexdigest()
        review = self.root / REVIEW_FILE
        review.parent.mkdir(parents=True, exist_ok=True)
        review.write_text(json.dumps({
            "reviewStatus": "approved", "versionCode": 10, "versionName": "0.5.5",
            "artifactSha256": self.approval_sha,
            "priorSequence": 35, "priorCode9Sha256": PRIOR_SHA,
        }), encoding="utf-8")

    def check(self, *, event="workflow_dispatch", approval=APPROVAL, sha=None):
        return check_code10_publication(
            self.root, event, approval, self.approval_sha if sha is None else sha,
        )

    def test_actual_development_branch_remains_inert_even_with_manual_approval(self):
        self.assertEqual(
            self.check(), "DEVELOPMENT_ONLY_NOT_SIGNED",
        )
        self.assertEqual(
            check_mangaall_publication(
                self.root, event="workflow_dispatch", code10_approval=APPROVAL,
                code10_sha="f" * 64,
            ),
            "DEVELOPMENT_ONLY_NOT_SIGNED",
        )
        self.assertFalse((self.root / REVIEW_FILE).exists())
        self.assertFalse((self.root / "dist/providers/app.tsuzuki.mangaall-10.tsz").exists())

    def test_manual_release_requires_reviewed_bytes_and_original_p256_index(self):
        self.ready_release()
        self.assertEqual(
            self.check(), "AUTHORIZED_CODE10_PREFLIGHT_ONLY_NOT_SIGNED",
        )
        self.assertEqual(
            check_mangaall_publication(
                self.root, event="workflow_dispatch", code10_approval=APPROVAL,
                code10_sha=self.approval_sha,
            ), "AUTHORIZED_CODE10_PREFLIGHT_ONLY_NOT_SIGNED",
        )
        self.assertNotEqual(self.approval_sha, PRIOR_SHA)
        self.assertEqual(json.loads((self.root / "repository/config.json").read_text())["sequence"], 35)
        self.assertEqual(
            json.loads((self.root / "dist/index.payload.json").read_text())["providers"][
                next(i for i, x in enumerate(json.loads(
                    (self.root / "dist/index.payload.json").read_text()
                )["providers"]) if x["providerId"] == "app.tsuzuki.mangaall")
            ]["versionCode"], 9,
        )

    def test_manual_dispatch_and_code10_specific_approval_are_required(self):
        self.ready_release()
        for event, approval in (
            ("push", APPROVAL), ("pull_request", APPROVAL),
            ("workflow_dispatch", ""), ("workflow_dispatch", "PUBLISH_MANGAALL_CODE9"),
            ("workflow_dispatch", APPROVAL + " "),
        ):
            with self.subTest(event=event, approval=approval), self.assertRaisesRegex(
                ValueError, "manual workflow dispatch",
            ):
                self.check(event=event, approval=approval)
        with self.assertRaisesRegex(ValueError, "Historical code9"):
            check_mangaall_publication(
                self.root, event="workflow_dispatch", code9_approval="PUBLISH_MANGAALL_CODE9",
                code10_approval=APPROVAL, code10_sha=self.approval_sha,
            )
        with self.assertRaisesRegex(ValueError, "exact 64-char"):
            self.check(sha="deadbeef")
        with self.assertRaisesRegex(ValueError, "exact 64-char"):
            self.check(sha=self.approval_sha.upper())
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.check(sha="1" * 64)

    def test_review_lock_missing_or_tampered_denies_signing(self):
        self.ready_release()
        lock = self.root / REVIEW_FILE
        stored = lock.read_text()
        lock.unlink()
        with self.assertRaisesRegex(ValueError, "independently reviewed"):
            self.check()
        lock.write_text(stored)
        for mutation in (
            {"reviewStatus": "pending"},
            {"versionName": "0.5.5-dev"},
            {"priorSequence": 36},
            {"priorCode9Sha256": "0" * 64},
            {"artifactSha256": "f" * 64},
            {"unreviewed": "yes"},
        ):
            locked = json.loads(stored)
            locked.update(mutation)
            lock.write_text(json.dumps(locked))
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, "review lock"):
                self.check()

    def test_prior_signed_index_and_original_code9_must_be_immutable(self):
        self.ready_release()
        index = self.root / "dist/index.json"
        signed = json.loads(index.read_text())
        signed["signatureBase64"] = "AA" + signed["signatureBase64"][2:]
        index.write_text(json.dumps(signed))
        with self.assertRaisesRegex(ValueError, "P-256"):
            self.check()
        shutil.copyfile(HISTORICAL / "dist/index.json", index)
        old = self.root / "dist/providers/app.tsuzuki.mangaall-9.tsz"
        old.write_bytes(old.read_bytes() + b"tampered")
        with self.assertRaisesRegex(ValueError, "code9 archive"):
            self.check()

    def test_review_digest_cannot_cover_different_source_or_broader_permissions(self):
        self.ready_release()
        js = self.root / "providers/mangaall/modules/router.js"
        js.write_text(js.read_text() + "\n// a changed, unreviewed source\n")
        with self.assertRaisesRegex(ValueError, "source differs"):
            self.check()
        # Even if an attacker could alter the manually reviewed SHA and lock,
        # extra network permissions violate the independent original code9 grant.
        data = json.loads(self.source.read_text())
        data["permissions"]["network"]["origins"].append("https://unreviewed.example")
        self.source.write_text(json.dumps(data))
        self.ready_release()
        with self.assertRaisesRegex(ValueError, "grants or identity"):
            self.check()

    def test_published_code9_is_unchanged_by_gate(self):
        before = {
            str(path): hashlib.sha256((self.root / path).read_bytes()).hexdigest()
            for path in (
                "dist/index.json", "dist/index.payload.json",
                "dist/providers/app.tsuzuki.mangaall-9.tsz",
                "repository/config.json", "repository/public-key.pem",
            )
        }
        self.ready_release()
        self.check()
        after = {
            str(path): hashlib.sha256((self.root / path).read_bytes()).hexdigest()
            for path in (
                "dist/index.json", "dist/index.payload.json",
                "dist/providers/app.tsuzuki.mangaall-9.tsz",
                "repository/config.json", "repository/public-key.pem",
            )
        }
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
