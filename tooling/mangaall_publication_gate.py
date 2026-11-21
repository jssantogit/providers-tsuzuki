#!/usr/bin/env python3
"""Route to the independently reviewed pre-signature gate for each generation.

The already published P-256/code9 gate must not be repurposed for code10.
Every branch is fail-closed; this entry point does not sign or publish.
"""
import json
import os
import pathlib

from mangaall_code9_publication_gate import check_code9_publication
from mangaall_code10_publication_gate import check_code10_publication

ROOT = pathlib.Path(__file__).resolve().parents[1]


def check_mangaall_publication(root, *, event, code9_approval="", code10_approval="", code10_sha=""):
    root = pathlib.Path(root)
    manifest = json.loads((root / "providers/mangaall/manifest.json").read_text(encoding="utf-8"))
    code = manifest.get("version", {}).get("code")
    if type(code) is not int:
        raise ValueError("MangaAll publication gate requires integer version code")
    if code == 10:
        if code9_approval:
            raise ValueError("Historical code9 authorization is invalid for code10")
        return check_code10_publication(root, event, code10_approval, code10_sha)
    if code10_approval or code10_sha:
        raise ValueError("Code10 authorization cannot apply to historical code9")
    if code > 10:
        raise ValueError("Code11+ requires a separately reviewed release gate")
    return check_code9_publication(root, event, code9_approval)


if __name__ == "__main__":
    state = check_mangaall_publication(
        ROOT, event=os.environ.get("MANGAALL_RELEASE_EVENT", ""),
        code9_approval=os.environ.get("MANGAALL_CODE9_AUTHORIZATION", ""),
        code10_approval=os.environ.get("MANGAALL_CODE10_AUTHORIZATION", ""),
        code10_sha=os.environ.get("MANGAALL_CODE10_APPROVED_SHA256", ""),
    )
    print("MANGAALL_PRE_SIGNATURE_RELEASE_GATE|outcome=" + state)
