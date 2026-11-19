# MangaAll — candidate V2 partial-source diagnostics, NOT published

Date: 2026-11-19. Status: **UNSIGNED CONTRACT CANDIDATE — test only**.
Tracks [providers #72](https://github.com/jssantogit/providers-tsuzuki/issues/72)
and [Host #207](https://github.com/jssantogit/tsuzuki/issues/207).

## Why

The signed MangaAll 0.5.3/code8 router invokes three adapters in the same
lookup, but an exhausted source retry returns one global error envelope.
Real [Android run #44547565977](https://github.com/jssantogit/tsuzuki/actions/runs/44547565977)
observed `UNCLASSIFIED_ERROR` for Death Note, `CHALLENGE_BLOCKED/403`
for Naruto and Bleach; all three lookups were incomplete. The observed
global error **cannot** identify which adapter was blocked, and cannot
prove all three adapters returned zero candidates.

The new experimental `tooling/mangaall_lookup_v2_candidate.mjs` imports
the **original** `createMangaAllReading` router and observes its adapters
*within the same concurrent lookup*. It does not make three separate
workflow runs and does not make additional network requests. It is
deliberately outside the provider's package sources.

## Contract semantics

A call with `diagnosticsVersion: 2` produces a separate envelope:

- `contractVersion: 2`, `providerId: app.tsuzuki.mangaall`
- `sourceStatuses` in fixed `mangadex,mangadot,mangafire` order, each
  with bounded attempts, per-request success/failure, bounded HTTP
  status and closed reason, page cursor completion and observed count
- `observedCandidates`: bounded title/aliases/authors and *source-owned*
  work IDs from **actually returned** adapter objects only; no URLs,
  page bytes, cookies, authorization headers or raw exceptions
- `lookupComplete`: true only if **the first/only page** of a
  three-source request completed without any failure or continuation.
  Other pages need Host aggregation across cursor history
- `state` distinguishes `COMPLETE_SINGLE_PAGE`, `PARTIAL_EVIDENCE`
  and `INCONCLUSIVE`; `continuationCursor` is an opaque in-memory
  transport only when the original router authorizes continuation
- `eligibleForCanonicalBinding=false`, `eligibleForReader=false`
  and `observedCandidates[*].bindingEligible=false` always. These
  facts **cannot** become a preferred edition, full source snapshot,
  chapter mapping, no-match verdict or visible Reader without
  independent identity, completeness and Host-side validation

**No V1 `items` field is emitted from V2** so it cannot be accidentally
decoded as a successful legacy `ProviderPage`. Calling without V2
keeps the original router return path and behavior unchanged.

When a source runs out of its bounded retry, the V2 envelope preserves
closed per-source failure information and any *already observed* healthy
candidate metadata from previous V2 calls; consuming caller must
accumulate observations across cursor pages and retain an incomplete
state. It must not silently rewrite the published code8 failure
envelope. Individual source failures do not block observation of
others during the same router call.

## Validation

Offline test: `node tooling/test_mangaall_lookup_v2_candidate.mjs`.
CI also runs the original signed source-byte parity and packaging
checks. The new module is **not** imported from
`providers/mangaall/main.js`, not added to the manifest, not signed,
not put into `dist`, not exposed to live Android, and **not** a release
candidate for direct use. All source calls in this test are mocks.

Scenarios covered: all sources healthy; one source HTTP403 with bounded
retry while two healthy sources yield multiple editions; all blocked;
mixed HTTP/challenge/invalid/unclassified errors without exception
text leakage; malformed work metadata; multi-page cursor; missing
Portuguese facet support on MangaFire; V1 behavioral parity.

## Promotion gates not yet satisfied

1. Define a typed Host V2 model and validator. **V1 must continue to
   reject V2**. Explicitly mark direct-live versus real-capture replay
   provenance, bound serialized output, cursor history, and typed
   partial/error semantics. Check integrity of source-scoped identities
   and counts over all pages, including a later failed retry.
2. Integrate an adapted and reviewed V2 implementation into the future
   **code9+ candidate**. Do not claim any modified JS matches the
   immutable signed code8 archive. Review code/manifest, run provider
   + Host Android tests, sign and publish using normal release controls.
3. Run one real MangaAll lookup for three sources with per-adapter
   status, then Host evidence reconciliation and Reader. An HTTP403 in
   GitHub Actions remains `UPSTREAM_UNAVAILABLE_IN_RUNNER`. No
   challenge-bypass or device cookie reuse.
4. A single UI session exposing all eligible source options is a
   separate acceptance gate; the existing per-binding Reader fixture
   does not verify same-session source switching.

This stage proves contract and observation semantics **offline only**;
it does not prove live network accessibility or actual CDN pixels.
