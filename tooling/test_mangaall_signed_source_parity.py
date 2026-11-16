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
assert manifest["version"] == {"name": entry["versionName"], "code": entry["versionCode"]}
assert entry["versionCode"] == 8 and payload["sequence"] == 34
published = ROOT / f"dist/providers/app.tsuzuki.mangaall-{entry['versionCode']}.tsz"
published_digest = hashlib.sha256(published.read_bytes()).hexdigest()
assert published_digest == entry["sha256"]

with tempfile.TemporaryDirectory(prefix="tsuzuki-code8-parity-") as directory:
    output = Path(directory) / "exact.tsz"
    subprocess.run(
        [sys.executable, "tooling/build_provider.py", "providers/mangaall", str(output)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    rebuilt_digest = hashlib.sha256(output.read_bytes()).hexdigest()
    assert rebuilt_digest == published_digest, (
        "Live source JS bytes differ from the real signed MangaAll code8 artifact"
    )

print("MANGAALL_SIGNED_SOURCE_PARITY|version=code8|index=34|outcome=PASS")
