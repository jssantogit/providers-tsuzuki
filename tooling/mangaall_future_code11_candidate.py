#!/usr/bin/env python3
"""Build a future MangaALL code11 candidate ONLY in memory for offline tests.

No CLI flag writes a .tsz, changes providers/, updates dist/, signs or publishes.
The original production three-source router and all source modules are copied
byte-for-byte, except the top-level MangaDot import is retargeted to a tiny
future-only wrapper that calls the manifest-gated native snapshot service.
"""
import hashlib
import io
import json
from pathlib import Path
import zipfile

from build_provider import (
    MAX_ENTRIES,
    MAX_ENTRY_BYTES,
    MAX_TOTAL_BYTES,
    package_files,
)

SOURCE_MANIFEST_SHA = "419aa730ec6eb41e9bb854f872c6daf4efb47152"
SOURCE_MAIN_SHA = "537004106dffceee6012852feca47cb2b6e2cf52"
SOURCE_ROUTER_SHA = "8f23134ab1f0c2b2aacb9615400906d564056340"
SOURCE_MANGADOT_SHA = "c665cd883a3d7caee277781c00d57fd835799402"

ORIGINAL_IMPORT = b'from "./modules/sources/mangadot/main.js";'
FUTURE_IMPORT = b'from "./modules/sources/mangadot/future-main.js";'
FUTURE_MAIN_PATH = "modules/sources/mangadot/future-main.js"
FUTURE_BRIDGE_PATH = "modules/sources/mangadot/future-native-bridge.js"
BRIDGE_SOURCE = "tooling/mangaall_future_native_chapter_bridge.mjs"

FUTURE_MAIN = b"""/*
 * NONSHIPPING overlay. Uses the SAME three-source product/router; changes
 * only the MangaDot reading.chapters adapter. Lookup and Reader pages stay
 * on the original source module. This does not grant editorial authority.
 */
import original from "./main.js";
import { futureMangaDotChaptersViaNativeHost } from "./future-native-bridge.js";
export default {
  reading: {
    ...original.reading,
    chapters: (input) => futureMangaDotChaptersViaNativeHost(
      input, globalThis.tsuzuki?.mangaAllChapterSnapshot,
    ),
  },
};
"""


def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(
        b"blob " + str(len(content)).encode("ascii") + b"\0" + content
    ).hexdigest()


def unsigned_candidate_zip(repo_root: Path) -> bytes:
    """Create deterministic, bounded unsigned ZIP bytes; never install them."""
    source = repo_root / "providers" / "mangaall"
    manifest, paths = package_files(source)
    if (
        manifest.get("id") != "app.tsuzuki.mangaall"
        or manifest.get("version") != {"name": "0.5.5", "code": 10}
        or manifest.get("minHostApi") != 1
        or manifest.get("permissions", {}).get("storage", {}).get("enabled") is not False
        or manifest.get("publication") != "release"
        or manifest.get("permissions", {}).get("mangaAllChapterSnapshot") is not None
    ):
        raise ValueError("Expected original published code10 manifest, no new grant")

    files = {name: path.read_bytes() for name, path in paths}
    verified = {
        "manifest.json": SOURCE_MANIFEST_SHA,
        "main.js": SOURCE_MAIN_SHA,
        "modules/router.js": SOURCE_ROUTER_SHA,
        "modules/sources/mangadot/modules/mangadot.js": SOURCE_MANGADOT_SHA,
    }
    for name, pinned_sha in verified.items():
        if git_blob_sha(files[name]) != pinned_sha:
            raise ValueError("Code10 source pin drifted: " + name)

    if files["main.js"].count(ORIGINAL_IMPORT) != 1:
        raise ValueError("Original MangaDot top-level import is not unique")
    files["main.js"] = files["main.js"].replace(ORIGINAL_IMPORT, FUTURE_IMPORT)
    files[FUTURE_MAIN_PATH] = FUTURE_MAIN
    files[FUTURE_BRIDGE_PATH] = (repo_root / BRIDGE_SOURCE).read_bytes()
    if b"Buffer.byteLength" in files[FUTURE_BRIDGE_PATH] or b"from 'node:" in files[FUTURE_BRIDGE_PATH]:
        raise ValueError("Future bridge must not import Node runtime APIs")

    runtime_manifest = {k: v for k, v in manifest.items() if k != "publication"}
    runtime_manifest["version"] = {"name": "0.6.0-unsigned-research", "code": 11}
    runtime_manifest["minHostApi"] = 2
    runtime_manifest["permissions"]["mangaAllChapterSnapshot"] = {"enabled": True}
    files["manifest.json"] = json.dumps(
        runtime_manifest, ensure_ascii=False, indent=2
    ).encode("utf-8")

    if len(files) > MAX_ENTRIES or any(len(b) > MAX_ENTRY_BYTES for b in files.values()):
        raise ValueError("Future unsigned package exceeds per-entry budget")
    if sum(map(len, files.values())) > MAX_TOTAL_BYTES:
        raise ValueError("Future unsigned package exceeds total uncompressed budget")

    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipf:
        for relative, body in sorted(files.items()):
            path = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            path.compress_type = zipfile.ZIP_DEFLATED
            path.external_attr = 0o100644 << 16
            zipf.writestr(path, body)
    return output.getvalue()


if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parent.parent
    blob = unsigned_candidate_zip(repo_root)
    print(
        "MANGAALL_FUTURE_CODE11|memory_only=TRUE|unsigned=TRUE|"
        "three_source_router=UNCHANGED|code10=PINNED|"
        "sha256=" + hashlib.sha256(blob).hexdigest()
    )
