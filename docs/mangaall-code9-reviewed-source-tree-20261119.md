# MangaAll code9 — reviewed source overlay from immutable signed code8

Date: 2026-11-19. Status: **SOURCE REVIEW / UNSIGNED / UNPUBLISHED / OFFLINE ONLY**.

## Source of truth and safety boundary

`review/mangaall-code9/` contains exactly **three** reviewed files:

- `manifest.json`: `app.tsuzuki.mangaall` **0.5.4/code9**, same capabilities,
  content languages, permissions and network origins as code8, with
  `publication=development`. This is not a published manifest.
- `main.js`: one MangaAll router, wrapping all three unchanged
  MangaDex, MangaDot and MangaFire adapters for read-only V2 diagnostics;
  V1 lookup/chapter/page semantics remain on the original router.
- `modules/v2-candidate.js`: the neutral `V2_READONLY_OBSERVATION`
  wire protocol, with a strict **48 KiB UTF-8 payload budget** matching the
  Host decoder. When oversized, observed candidates are dropped from
  **diagnostic output only**, source `observationsTruncated=true` and
  `lookupComplete=false`. This must never grant canonical binding or Reader.

`tooling/mangaall_code9_review_source.py` reads the **existing indexed
code8 .tsz**, validates its SHA-256 against signed index sequence **34**,
the pinned repository/key ID, and the P-256 public key fingerprint
`20875348d95649ff0009e329f0d43de1b84ccf8af7966c215d5e0f449e697159`
used by Host PR #223. The CI separately verifies the cryptographic
signature of the original index with `tooling/verify_index.mjs`.

The tool expands the immutable code8 ZIP into a **temporary directory
outside the repo**, validates bounded safe archive members, overlays
exactly the three reviewed files and builds a reproducible
`app.tsuzuki.mangaall-9-REVIEW-UNSIGNED.tsz`. It cannot modify source
`providers/mangaall`, `dist/`, `repository/`, the signing key,
the official index or any installed Android package.

**This archive is UNSIGNED.** Its `0.5.4` manifest version matches the
*future signed-contract version* only for code review and offline testing.
A version string, a host-provenance marker or a matching repository ID in
JS does not create installation trust. The Host requires verification through
its actual installed-artifact ledger and pinned root.

## Tests and acceptance

Run (offline only):

```sh
python3 -m unittest discover -s tooling -p 'test_mangaall_code9_review_source.py' -v
```

Provider CI runs this plus the signed code8 source/index parity,
unrelated providers' conformance, prior code9 preview and publication
preflight tests, and a signed publication **dry-run without signing**.

The review tests verify deterministic ZIP bytes, original three adapter
modules, preservation of source permissions, neutral V2 response,
V1 continuity, source-specific 403 while healthy sources report observations,
full UTF-8 serialized envelope **<= 48 KiB**, incomplete verdict on
truncation, and deliberate refusal of tampered archived code8, substituted
trust root, widened permissions, removed adapters and extra source overlays.
No source HTTP, CDN fetch, actual ReaderActivity or editor identity decision
is executed.

## Release blockers — not approved by these tests

1. Review code9 source and bounded behavior independently, including Host
   decoder compatibility and the editorial metadata evidence policy.
2. A separate reviewed source-promotion PR would copy this exact overlay
   into `providers/mangaall` and require **explicit** `publication=release`.
   The official code9 gate requires a manual
   `PUBLISH_MANGAALL_CODE9` authorization; this PR does NOT make that change
   or trigger it.
3. Verify actual P-256 index signature, artifact SHA and official installation
   of code9 on a disposable Android environment. The current synthetic
   QuickJS opt-in does **not** demonstrate a signed package.
4. Obtain independent, real editorial identity evidence, then test all
   eligible source choices in one Reader Android UI session and actual
   permitted CDN pixels while retaining original chapter/progress.
   HTTP 403/challenges must not be bypassed.

Until those gates pass, **the published MangaAll remains immutable
0.5.3/code8, index sequence 34**, and V2 remains disabled for users.

Tracks [Provider #72](https://github.com/jssantogit/providers-tsuzuki/issues/72),
[Host #207](https://github.com/jssantogit/tsuzuki/issues/207),
[Host PR #223](https://github.com/jssantogit/tsuzuki/pull/223),
[Provider PR #75](https://github.com/jssantogit/providers-tsuzuki/pull/75)
and [Provider PR #76](https://github.com/jssantogit/providers-tsuzuki/pull/76).
