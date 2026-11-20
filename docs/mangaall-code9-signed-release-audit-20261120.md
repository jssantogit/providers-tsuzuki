# MangaAll 0.5.4/code9 — first *real* signed-index verification

As of 2026-11-20, the **source** for 0.5.4/code9 has been promoted in
Provider PR #80 but the **current official signed index is still
sequence 34/MangaAll 0.5.3/code8**. Source promotion alone is not a
signed release. A real code9 audit cannot be green until the publisher
actually signs a new index.

## Read-only signed release audit

When an authorized operator has published code9 via the existing official
`Publish repository` manual `workflow_dispatch`, with the literal input
`PUBLISH_MANGAALL_CODE9`, run the new
`MangaAll code9 — verify officially signed release (read-only)` workflow.

The workflow has **read-only GitHub permissions** and obtains:

- The **current** official source, P-256 signed repository index, archived
  artifacts, reviewed code9 source overlay and trust root.
- The **original** immutable signed sequence 34 snapshot pinned to
  `99f3565a1e1edc0d8ed249b7597006c897f02636`.

It runs the actual `tooling/verify_index.mjs` in **both** repositories,
verifying P-256 signatures and hashes of every indexed artifact, with
no signing key or publishing step. The new
`tooling/mangaall_code9_signed_release_audit.py` then checks:

1. Sequence **34 -> 35** exactly, unchanged repository ID, pinned
   P-256 key `tsuzuki-provider-root-2026-02` and SHA-256 fingerprint
   `20875348d95649ff0009e329f0d43de1b84ccf8af7966c215d5e0f449e697159`.
2. A single MangaAll upgrade from 0.5.3/code8 to **0.5.4/code9**,
   with exact artifact URL, SHA and unchanged minHostApi.
3. All **unrelated Provider descriptors** and the original code8
   archive remain exactly unchanged.
4. The **code9 archive** has the same bytes as BOTH a deterministic build
   of the promoted source and the approved three-file review overlay
   independently materialized over the historic signed code8 archive.

The marker `OFFICIAL_CODE9_SIGNED_INDEX_VERIFIED` means **only**
the real cryptographically verified catalog/index + code9 archive.
It does **not** prove Host installed origin, Reader grants, editorial
source identity, a usable upstream API or real CDN pixels.

## Fail closed now

Until official publication happens, the workflow will fail with
`Real code9 requires published sequence 35`. Provider PR CI includes
negative regression tests to ensure the current signed code8 index and
tampered signatures are **never** accepted as signed code9.

No action in this PR publishes, signs, modifies release metadata,
installs code9, or contacts upstream sources. Host Android actual signed
installation and Reader/CDN live tests are separate pending gates.

See [Provider #72](https://github.com/jssantogit/providers-tsuzuki/issues/72)
and [Host #207](https://github.com/jssantogit/tsuzuki/issues/207).
