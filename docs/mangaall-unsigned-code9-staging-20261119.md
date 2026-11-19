# MangaAll code9 — isolated, UNSIGNED package staging

2026-11-19. **Development artifact only; not published or installed.**

## Why this exists

The original published MangaAll 0.5.3/code8 package is signed and
byte-for-byte protected by `tooling/test_mangaall_signed_source_parity.py`.
Direct edits to its JS, manifest or index would invalidate provenance.

The experimental unified V2 three-source diagnostics in
`tooling/mangaall_lookup_v2_candidate.mjs` passed offline tests
([Provider PR #73](https://github.com/jssantogit/providers-tsuzuki/pull/73)).
The companion Host read-only validator and accumulator are separately
developed in Tsuzuki. A self-contained package candidate is needed to
verify imports and capability parity before touching publication.

## Operation

Run `python3 tooling/test_mangaall_code9_staging.py`. It:

1. Attests existing signed code8 manifest/index and published digest.
2. Copies `providers/mangaall` into a **temporary directory outside
   the repository**. The original code8 files remain untouched.
3. Bumps only this temporary manifest to `0.5.4-dev-unsigned/code9`
   with `publication=development`. The release workflow never sees
   that manifest and no repository index is updated.
4. Adds the V2 wrapper within the temporary `modules/` tree,
   rewrites only temporary `main.js` to use the three-source
   `createMangaAllLookupV2Candidate` router, while preserving
   `lookup`, `chapters` and `pages` methods.
5. Invokes the existing `tooling/build_provider.py` to create a
   local `app.tsuzuki.mangaall-9-UNSIGNED.tsz` ZIP.
6. Inspects package manifest/imports/capabilities; imports its real
   staged JS entrypoint in Node using **synthetic HTTP responses**.
   Confirms unchanged V1 lookup shape and V2 closed per-source
   observations from the same MangaAll router.
7. Deletes the staging files with the temporary directory.

**No signature, release index, CDN access, installation or device
state is produced.** A generated ZIP with matching provider ID is
*not* a trusted signed provider and must not be distributed or used
for live Android tests without separate reviewed release controls.

## Limits and next gates

- The staged package's V2 mode is **not accessible through the
  production Host V1 invocation contract**. The current Host parser
  and multi-page accumulator remain **offline, inactive** until
  a new version-gated Host invocation/decoder is explicitly wired.
- V2 response is intentionally **not** the V1 `ProviderPage`. Host V1
  must reject it rather than accidentally interpreting partial
  evidence as a successful/empty catalog.
- Candidate observations are never canonical editions or Reader grants.
  A future code9 package needs full security review, signature,
  explicit opt-in publication, cross-source cursor-history tests and
  real Reader evidence before it can replace code8.
- HTTP403/challenge is not bypassed. Captured/replayed HTTP fixtures do
  not prove direct-live CDN pixels.
- No new user-facing source option is activated in the installed app.

Tracks [Provider #72](https://github.com/jssantogit/providers-tsuzuki/issues/72)
and [Host #207](https://github.com/jssantogit/tsuzuki/issues/207).
