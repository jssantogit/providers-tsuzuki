#!/usr/bin/env python3
import argparse
import json
import pathlib
import zipfile

FORBIDDEN_SUFFIXES = {".apk", ".dex", ".jar", ".so", ".wasm"}
MAX_ENTRIES = 256
MAX_ENTRY_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024


def package_files(provider_dir: pathlib.Path):
    manifest = json.loads((provider_dir / "manifest.json").read_text(encoding="utf-8"))
    entrypoint = manifest["entrypoint"]
    candidates = [provider_dir / "manifest.json", provider_dir / entrypoint]
    for dirname in ("modules", "assets"):
        root = provider_dir / dirname
        if root.exists():
            candidates.extend(path for path in root.rglob("*") if path.is_file())

    unique = {}
    for path in candidates:
        relative = path.relative_to(provider_dir).as_posix()
        if relative.startswith("/") or ".." in pathlib.PurePosixPath(relative).parts:
            raise SystemExit(f"unsafe Provider path: {relative}")
        if pathlib.PurePosixPath(relative).suffix.lower() in FORBIDDEN_SUFFIXES:
            raise SystemExit(f"forbidden executable payload: {relative}")
        unique[relative] = path
    return manifest, sorted(unique.items())


def build(provider_dir: pathlib.Path, output: pathlib.Path):
    manifest, files = package_files(provider_dir)
    if len(files) > MAX_ENTRIES:
        raise SystemExit("Provider package contains too many files")

    total = 0
    for relative, path in files:
        size = path.stat().st_size
        if size > MAX_ENTRY_BYTES:
            raise SystemExit(f"Provider file exceeds per-entry limit: {relative}")
        total += size
    if total > MAX_TOTAL_BYTES:
        raise SystemExit("Provider package exceeds total uncompressed size limit")

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative, path in files:
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())

    print(f"built {manifest['id']} {manifest['version']['name']} -> {output}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("provider_dir", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    build(args.provider_dir, args.output)


if __name__ == "__main__":
    main()
