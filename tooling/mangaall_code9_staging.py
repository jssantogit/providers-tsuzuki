#!/usr/bin/env python3
"""Stage an UNSIGNED MangaAll code9 package into a disposable external directory.

The published code8 sources, index, trust root, and release workflow are never
modified. This cannot sign, publish or promote the package to the repository.
"""
import json
import pathlib
import tempfile

from build_provider import build
from mangaall_code9_review_source import _extract_base_archive, _read_signed_baseline

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROVIDER = ROOT / "providers" / "mangaall"
V2_SOURCE = ROOT / "tooling" / "mangaall_lookup_v2_candidate.mjs"
MAIN_IMPORT = 'import { createMangaAllReading } from "./modules/router.js";'
STAGED_IMPORT = 'import { createMangaAllLookupV2Candidate } from "./modules/v2-candidate.js";'
WRAPPER_IMPORT = 'from "../providers/mangaall/modules/router.js";'
STAGED_WRAPPER_IMPORT = 'from "./router.js";'


# Preview is intentionally neither a signed artifact nor an installable code9.
# A separate, explicit mode prevents accidental promotion of the old test wire.
UNSIGNED_WIRE = 'provenance: "UNSIGNED_CANDIDATE_NOT_LIVE",'
NEUTRAL_WIRE = 'provenance: "V2_READONLY_OBSERVATION",'


def _stage_code9(
    output_root: pathlib.Path,
    *,
    neutral_wire_preview: bool,
) -> pathlib.Path:
    output_root = output_root.resolve()
    # Explicitly refuse any destination under this repository or dist/.
    if output_root == ROOT or ROOT in output_root.parents:
        raise ValueError("Code9 staging output must be outside the source repository")
    if output_root.exists() and any(output_root.iterdir()):
        raise ValueError("Code9 staging directory must be empty")
    output_root.mkdir(parents=True, exist_ok=True)

    # After source promotion, providers/mangaall/ is code9. The old unsigned
    # fixture MUST still be derived from immutable indexed code8, not from
    # the newer untrusted source tree. Shared baseline checks pin SHA/key.
    immutable = _read_signed_baseline(ROOT)
    staged = output_root / "candidate"
    staged.mkdir()
    staged_manifest = _extract_base_archive(immutable, staged)
    if staged_manifest.get("version") != {"name": "0.5.3", "code": 8}:
        raise ValueError("Refuse staging: indexed code8 has an unexpected manifest")
    staged_manifest["version"] = {
        "name": "0.5.4-preview-unsigned" if neutral_wire_preview else "0.5.4-dev-unsigned",
        "code": 9,
    }
    staged_manifest["publication"] = "development"
    (staged / "manifest.json").write_text(
        json.dumps(staged_manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    main_file = staged / "main.js"
    original_main = main_file.read_text(encoding="utf-8")
    if original_main.count(MAIN_IMPORT) != 1 or original_main.count(
        "createMangaAllReading("
    ) != 1:
        raise ValueError("Staging entrypoint replacement is not uniquely anchored")
    main_file.write_text(
        original_main.replace(MAIN_IMPORT, STAGED_IMPORT).replace(
            "createMangaAllReading(", "createMangaAllLookupV2Candidate("
        ),
        encoding="utf-8",
    )

    wrapper = V2_SOURCE.read_text(encoding="utf-8")
    if wrapper.count(WRAPPER_IMPORT) != 1:
        raise ValueError("Staging candidate's router import is not uniquely anchored")
    wrapper = wrapper.replace(WRAPPER_IMPORT, STAGED_WRAPPER_IMPORT)
    if wrapper.count(UNSIGNED_WIRE) != 1:
        raise ValueError("V2 source's unsigned wire marker is not uniquely anchored")
    if neutral_wire_preview:
        wrapper = wrapper.replace(UNSIGNED_WIRE, NEUTRAL_WIRE)
        if "UNSIGNED_CANDIDATE_NOT_LIVE" in wrapper:
            raise ValueError("Unsigned marker cannot survive in neutral preview")
    (staged / "modules/v2-candidate.js").write_text(wrapper, encoding="utf-8")

    artifact = output_root / (
        "app.tsuzuki.mangaall-9-UNSIGNED-NEUTRAL-PREVIEW.tsz"
        if neutral_wire_preview else "app.tsuzuki.mangaall-9-UNSIGNED.tsz"
    )
    build(staged, artifact)
    print(
        "MANGAALL_CODE9_STAGING|provider=app.tsuzuki.mangaall"
        "|code=9|state="
        + ("UNSIGNED_NEUTRAL_WIRE_PREVIEW" if neutral_wire_preview else "UNSIGNED_LOCAL_ONLY")
        + "|publishedCode8=UNTOUCHED"
    )
    return artifact


def stage_unsigned_code9(output_root: pathlib.Path) -> pathlib.Path:
    """Legacy 0.5.4-dev-unsigned fixture; never accepted as signed code9."""
    return _stage_code9(output_root, neutral_wire_preview=False)


def stage_unsigned_code9_neutral_wire_preview(output_root: pathlib.Path) -> pathlib.Path:
    """Review the neutral V2 wire without changing the source manifest or index.

    The version is deliberately NOT the Host's signed 0.5.4; no production
    release path consumes this temporary archive or this staging directory.
    """
    return _stage_code9(output_root, neutral_wire_preview=True)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="mangaall-code9-unsigned-") as tmp:
        stage_unsigned_code9(pathlib.Path(tmp))
