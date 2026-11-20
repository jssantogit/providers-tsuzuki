#!/usr/bin/env python3
"""Fail-closed post-signing audit tests: no signer or repository mutation."""
import pathlib
import shutil
import tempfile
import unittest

from mangaall_code9_signed_release_audit import ROOT, audit_signed_code9


class MangaAllCode9SignedReleaseAuditTest(unittest.TestCase):
    def baseline(self, temp):
        prior = pathlib.Path(temp) / "prior"
        shutil.copytree(ROOT / "dist", prior / "dist")
        shutil.copytree(ROOT / "repository", prior / "repository")
        (prior / "tooling").mkdir(parents=True)
        shutil.copyfile(ROOT / "tooling/verify_index.mjs", prior / "tooling/verify_index.mjs")
        return prior

    def test_unpublished_code9_cannot_pass_even_when_review_source_is_release(self):
        with tempfile.TemporaryDirectory(prefix="code9-audit-no-signer-") as temp:
            prior = self.baseline(temp)
            with self.assertRaisesRegex(ValueError, "published sequence 35"):
                audit_signed_code9(ROOT, prior)

    def test_signature_tamper_fails_before_any_positive_code9_verdict(self):
        with tempfile.TemporaryDirectory(prefix="code9-audit-bad-signature-") as temp:
            prior = self.baseline(temp)
            path = prior / "dist/index.json"
            path.write_bytes(path.read_bytes().replace(b"signatureBase64", b"tamperedSignature"))
            with self.assertRaisesRegex(ValueError, "P-256 signed index verification failed"):
                audit_signed_code9(ROOT, prior)


if __name__ == "__main__":
    unittest.main()
