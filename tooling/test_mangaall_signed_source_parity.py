"""Ensure live JS on main is byte-for-byte the already signed MangaAll package.

Pure local preflight; does not send network requests or mint signatures.
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
payload = json.loads((ROOT / "dist/index.payload.json").read_text())
assert payload["repositoryId"] == "app.tsuzuki.providers"
candidates = [p for p in payload["providers"] if p["providerId"] == "app.tsuzuki.mangaall"]
assert len(candidates) == 1, "MangaAll must remain a single installed provider"
entry = candidates[0]
manifest = json.loads((ROOT / "providers/mangaall/manifest.json").read_text())
assert manifest["id"] == entry["providerId"]
assert entry["versionCode"] >= 8 and payload["sequence"] >= 34
assert manifest["version"]["code"] >= entry["versionCode"], (
    "Provider source manifest must never downgrade below the signed version"
)
if manifest["version"]["code"] > entry["versionCode"]:
    # Normal code9+ development cannot yet match the immutable published
    # archive. Keep regular PR CI green and label the version UNSIGNED;
    # the opt-in LIVE runner separately refuses unsigned source/JS parity.
    print(
        "MANGAALL_SIGNED_SOURCE_PARITY|publishedCode="
        + str(entry["versionCode"])
        + "|candidateCode=" + str(manifest["version"]["code"])
        + "|outcome=UNPUBLISHED_CANDIDATE_NOT_ATTESTED"
    )
    sys.exit(0)
assert manifest["version"]["name"] == entry["versionName"]
published = ROOT / f"dist/providers/app.tsuzuki.mangaall-{entry['versionCode']}.tsz"
published_digest = hashlib.sha256(published.read_bytes()).hexdigest()
assert published_digest == entry["sha256"]

with tempfile.TemporaryDirectory(prefix="tsuzuki-signed-parity-") as directory:
    output = Path(directory) / "exact.tsz"
    subprocess.run(
        [sys.executable, "tooling/build_provider.py", "providers/mangaall", str(output)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    rebuilt_digest = hashlib.sha256(output.read_bytes()).hexdigest()
    assert rebuilt_digest == published_digest, (
        "Live source JS bytes differ from the currently signed MangaAll artifact"
    )

print(
    "MANGAALL_SIGNED_SOURCE_PARITY|versionCode="
    + str(entry["versionCode"])
    + "|index=" + str(payload["sequence"])
    + "|outcome=PASS"
)
