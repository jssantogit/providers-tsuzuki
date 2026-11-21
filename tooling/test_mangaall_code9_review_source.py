#!/usr/bin/env python3
"""Offline adversarial tests for the real, but UNPUBLISHED, code9 review tree."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest
import zipfile

from mangaall_code9_review_source import ROOT, materialize_review_code9
from mangaall_code9_publication_gate import check_code9_publication


class MangaAllCode9ReviewSourceTest(unittest.TestCase):
    def test_builds_exact_code9_from_pinned_code8_and_three_overlays(self):
        protected = [
            ROOT / "providers/mangaall/manifest.json",
            ROOT / "providers/mangaall/main.js",
            ROOT / "dist/providers/app.tsuzuki.mangaall-8.tsz",
            ROOT / "dist/index.payload.json",
            ROOT / "dist/index.json",
            ROOT / "repository/config.json",
        ]
        baseline = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
        with tempfile.TemporaryDirectory(prefix="mangaall-reviewed-code9-") as folder:
            root = pathlib.Path(folder)
            artifact = materialize_review_code9(root / "first")
            rebuilt = materialize_review_code9(root / "second")
            self.assertEqual(artifact.read_bytes(), rebuilt.read_bytes())
            self.assertEqual(
                {p.name for p in artifact.parent.iterdir()},
                {"candidate", "app.tsuzuki.mangaall-9-REVIEW-UNSIGNED.tsz"},
            )
            with zipfile.ZipFile(artifact) as bundle:
                paths = bundle.namelist()
                self.assertIn("modules/router.js", paths)
                for source in ("mangadex", "mangadot", "mangafire"):
                    self.assertIn(f"modules/sources/{source}/main.js", paths)
                self.assertIn("modules/v2-candidate.js", paths)
                self.assertNotIn("package.json", paths)
                self.assertTrue(all(not p.endswith((".pem", ".sig", ".key")) for p in paths))
                m = json.loads(bundle.read("manifest.json"))
                self.assertEqual(m["version"], {"name": "0.5.4", "code": 9})
                self.assertNotIn("publication", m)
                self.assertEqual(
                    m["permissions"],
                    json.loads((ROOT / "providers/mangaall/manifest.json").read_text())["permissions"],
                )
                self.assertIn(b"V2_READONLY_OBSERVATION", bundle.read("modules/v2-candidate.js"))
                self.assertNotIn(b"UNSIGNED_CANDIDATE_NOT_LIVE", bundle.read("modules/v2-candidate.js"))
            for runner in (
                "tooling/test_mangaall_code9_review_runtime.mjs",
                "tooling/test_mangaall_code9_review_entrypoint_http.mjs",
            ):
                result = subprocess.run(
                    ["node", runner, str(root / "first/candidate")],
                    cwd=ROOT, capture_output=True, text=True, timeout=30,
                )
                self.assertEqual(result.returncode, 0, result.stdout + "\n" + result.stderr)
                self.assertTrue(
                    "3sources=ONE_ROUTER" in result.stdout or
                    "3sources=ONE_LOOKUP" in result.stdout,
                    result.stdout,
                )
                self.assertTrue(
                    "payload=BOUNDED_48K" in result.stdout or
                    "403=SOURCE_SCOPED_AND_BOUNDED" in result.stdout,
                    result.stdout,
                )
        self.assertEqual(baseline, {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected})
        sequence = json.loads((ROOT / "dist/index.payload.json").read_text())["sequence"]
        source = json.loads((ROOT / "providers/mangaall/manifest.json").read_text())
        if sequence == 35 and source["publication"] == "release":
            with self.assertRaisesRegex(ValueError, "Code10\\+ requires"):
                check_code9_publication(ROOT, "push", "")
        elif sequence == 35:
            self.assertEqual(check_code9_publication(ROOT, "push", ""), "NO_CODE9_PROMOTION")
        elif sequence == 36:
            self.assertEqual(
                check_code9_publication(ROOT, "push", ""),
                "NO_CODE9_PROMOTION",
                "an already signed code10 must never reactivate historical code9",
            )
        else:
            with self.assertRaisesRegex(ValueError, "manual dispatch"):
                check_code9_publication(ROOT, "push", "")

    def make_isolated_root(self, sandbox):
        source = pathlib.Path(sandbox) / "source"
        for relative in (
            "dist/index.payload.json",
            "dist/enrollment.json",
            "dist/providers/app.tsuzuki.mangaall-8.tsz",
            "dist/providers/app.tsuzuki.mangaall-9.tsz",
            "dist/providers/app.tsuzuki.mangaall-10.tsz",
            "review/mangaall-code10/approved-artifact.json",
            "repository/config.json",
        ):
            dst = source / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, dst)
        shutil.copytree(ROOT / "review/mangaall-code9", source / "review/mangaall-code9")
        return source

    def test_fail_closed_on_code8_or_key_tampering(self):
        with tempfile.TemporaryDirectory(prefix="mangaall-review-adversarial-") as folder:
            root = pathlib.Path(folder)
            source = self.make_isolated_root(root)
            archive = source / "dist/providers/app.tsuzuki.mangaall-8.tsz"
            archive.write_bytes(archive.read_bytes() + b"tamper")
            with self.assertRaisesRegex(ValueError, "signed index digest"):
                materialize_review_code9(root / "bad-artifact", root=source)

            shutil.copyfile(ROOT / "dist/providers/app.tsuzuki.mangaall-8.tsz", archive)
            enrollment = source / "dist/enrollment.json"
            data = json.loads(enrollment.read_text())
            data["publicKeyBase64"] = "AA=="
            enrollment.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "Host pinned"):
                materialize_review_code9(root / "bad-root", root=source)

    def test_fail_closed_on_unreviewed_permission_and_module_changes(self):
        with tempfile.TemporaryDirectory(prefix="mangaall-review-source-tamper-") as folder:
            root = pathlib.Path(folder)
            source = self.make_isolated_root(root)
            manifest = source / "review/mangaall-code9/manifest.json"
            value = json.loads(manifest.read_text())
            value["permissions"]["network"]["origins"].append("https://untrusted.example")
            manifest.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, "permissions"):
                materialize_review_code9(root / "bad-permission", root=source)

            shutil.copyfile(ROOT / "review/mangaall-code9/manifest.json", manifest)
            main = source / "review/mangaall-code9/main.js"
            main.write_text(main.read_text().replace(
                'import mangaFire from "./modules/sources/mangafire/main.js";', "",
            ))
            with self.assertRaisesRegex(ValueError, "tri-source"):
                materialize_review_code9(root / "bad-adapter", root=source)

            shutil.copyfile(ROOT / "review/mangaall-code9/main.js", main)
            (source / "review/mangaall-code9/unapproved.js").write_text("export default 1;")
            with self.assertRaisesRegex(ValueError, "only the three"):
                materialize_review_code9(root / "bad-extra", root=source)

    def test_review_refuses_repository_destination(self):
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            materialize_review_code9(ROOT / "dist" / "code9-unsafe-review")


if __name__ == "__main__":
    unittest.main()
