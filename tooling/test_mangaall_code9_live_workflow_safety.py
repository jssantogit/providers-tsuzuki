#!/usr/bin/env python3
"""Keep the post-run direct-upstream probe manual and deliberately acknowledged."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/mangaall-code9-v2-direct-live-diagnostics.yml"


class ManualV2LiveSourceWorkflowSafetyTest(unittest.TestCase):
    def test_workflow_is_only_manually_triggered(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("  workflow_dispatch:", text)
        for unexpected in ("  pull_request:", "  push:", "  schedule:", "  workflow_run:"):
            self.assertNotIn(unexpected, text, unexpected)
        self.assertNotIn("github.head_ref", text)
        self.assertNotIn("github.event.pull_request", text)
        self.assertNotIn("test/mangaall-code9-v2-real-20261120", text)

    def test_live_only_after_acknowledgement_and_signed_source_check(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("ACKNOWLEDGEMENT: ${{ inputs.acknowledge_live_read_only }}", text)
        self.assertIn("test \"$ACKNOWLEDGEMENT\" = 'I_ACCEPT_LIVE_READ_ONLY'", text)
        self.assertIn("MANGAALL_CODE9_V2_TITLES: ${{ inputs.titles_json }}", text)
        self.assertIn("node tooling/verify_index.mjs", text)
        self.assertIn("Signed code9 differs from tested source", text)
        self.assertIn("dist/providers/app.tsuzuki.mangaall-9.tsz", text)
        self.assertIn("node tooling/test_mangaall_code9_live_v2.mjs", text)
        self.assertIn("node tooling/mangaall_code9_live_v2.mjs --live", text)
        self.assertNotIn("TSUZUKI_PROVIDER_SIGNING_KEY_PEM", text)


if __name__ == "__main__":
    unittest.main()
