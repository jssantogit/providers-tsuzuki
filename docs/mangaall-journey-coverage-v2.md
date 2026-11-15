# MangaAll 0.5.2/code7 — real-source journey calibration v2

Date: 2026-11-15. **Scope: read-only source diagnostics, NOT a proof of Host canonical chapter creation, Android Reader pixels, or source publication.** The only published provider remains `app.tsuzuki.mangaall` 0.5.2/code7 under the official signed repository sequence 33. This adds *tests only*, not a provider release.

## Coverage and evidence hierarchy

The curated corpus `tooling/mangaall_case_matrix.json` holds **65** stable work scenarios: 27 manga, 8 manhwa, 10 webtoon, 7 manhua, 7 light novels and 6 web novels. Japanese entries remain romanized, and Korean/Chinese display titles English. Formats overlap in the real world; these are deliberate test dimensions, not an exhaustive taxonomy. `tooling/test_mangaall_live_journey.mjs` exercises all 65 entries with deterministic **synthetic adapter responses** plus adversarial cases.

On **opt-in** live runs, `tooling/mangaall_live_matrix.mjs` imports the production MangaAll JS implementation and the real MangaDex/MangaDot/MangaFire internal modules, calling their actual public APIs through bounded, origin-pinned HTTP. The title names and aliases are curated real-world titles; the network responses are actually fetched at execution time, not recorded fixtures.

Only `mangafire:zk12` (Punpun) and `mangafire:7p56` (Koe no Katachi) are **previously verified source HIDs** from physical A54 evidence. For other *comic* candidates, the network test may inspect chapters and page metadata **only** when the lookup is complete, there is exactly one exact title/alias candidate across sources, and that candidate supplies source details, author(s) and observed chapter coverage. It labels these `UNVERIFIED_UNIQUE_API_CANDIDATE`; no editorial binding or canonical chapter authority is inferred or written. Source scope is preserved. A novel/web-novel title stays strictly discovery-only even if a comic shares the name.

## Source journey quality gates

For each bounded source work, capture:

- **Lookup**: each title/alias's paginated lookup, distinct source families, rival HIDs, same-source edition collisions, completeness of all inspected cursor chains, source author/details/coverage, and known exact work ID when independently observed. No first-page success when `nextCursor` still exists.
- **Chapter inventory**: read up to four source pages with strict cursor and chapter-ID cycle detection, source scoping, numeric and requested-language validation, count of accepted observations and explicit `chapterHasMore`. A truncated page window or a later HTTP failure remains `PARTIAL_PAGE_LIMIT` / `PARTIAL_UPSTREAM_ERROR`, never complete. A complete-empty source is `COMPLETE_EMPTY`, not "no manga chapters in all sources."
- **Missing/misaligned chapters**: report `chapterOnePresent`, first/last observed numbers and `numberingGapObserved`. These are **quality signals**, not assumptions about a particular edition's complete numbering or special chapters.
- **Reading**: request page URL metadata from the first valid source chapter (prefer numeric chapter 1), then one alternative when available. Validate the original manifest's HTTPS origin grants. `METADATA_OBSERVED` does **not** fetch image bytes or prove Android rendering.
- **Identity safety**: rival HIDs `AMBIGUOUS_EDITION`; unknown canonical author links remain unproven, even if a candidate advertises an author. Foreign-source chapter IDs, cycles, incompatible languages and bad CDN origins are `FAIL_CONTRACT`.
- **Degraded upstream**: HTTP 403, DNS/TLS/timeout, partial search and incomplete chapter pagination are typed and **inconclusive** rather than silently passed. After the first MangaFire 403, the runner stops further requests to that upstream. HTTP bodies, cookies, secrets, addresses, image bytes and raw cursors are never written to the report.

The distinction between `PASS_API` (known source HID and completely observed paginated source inventory with URL metadata), `SOURCE_JOURNEY_NOT_CANONICAL` (one unverified but directly observed source candidate), `PARTIAL_CHAPTER_INVENTORY`, `AMBIGUOUS_EDITION`, `EMPTY_SOURCE_INVENTORY`, `OBSERVED_API_DISCOVERY`, `INCONCLUSIVE`, and `FAIL_CONTRACT` is intentional. No fixed expected chapter total is invented for a third-party, mutable series.

## Execution

Regular Provider CI:

```sh
node tooling/test_mangaall_arsenal.mjs
node tooling/test_mangaall_live_journey.mjs
node tooling/test_mangaall_code8_host_contract_replay.mjs
node tooling/mangaall_live_matrix.mjs --self-test
```

The original code7 was signed and remains immutable at index sequence 33. This command now runs the current **code8 candidate** actual-JS replay; it does not alter or republish the signed code7 archive. See [code8 incomplete-source lookup diagnosis](mangaall-code8-incomplete-source-lookup-20261115.md).

Opt-in live run: [MangaAll live journey workflow](../.github/workflows/mangaall-live-matrix.yml). Select `core` (two previously verified HIDs), `cross-format` (seven representative cases from manga, manhwa, webtoon, manhua and prose), or a specific format and batch. All requests use a 12-minute workflow ceiling, guarded origins, capped pages and request budgets; there is no scheduling or automatic all-65 network fanout. The output artifact `mangaall-code7-live-journey-matrix` contains case IDs, closed outcomes, numerical counters, source-family summaries and request status classes, but not raw URLs/HIDs.

## Separate Host acceptance required

The actual canonical reconciliation and Reader authorization remain in `jssantogit/tsuzuki` (Host) and are **not** implemented in a JS provider. A complete native test must replay source results through `CollectProviderReadingEvidence`, `RefreshChapterEvidence`, `ReconcileChapterEvidence`, exact Provider binding/source selection and Reader content resolution; Host emulator acceptance tests can validate pixels only against **controlled local image fixtures**. A Galaxy A54 with the signed package is needed for real CDN bytes, browser challenges and checkpoint persistence across process restarts. The test suite must not substitute a successful public API lookup for these stages.

### Regression policy

CI should fail on malformed contracts and replay invariants, not on random third-party availability. Live-source degradation is surfaced as a dated typed report; a future trusted source-specific lower bound may be added only after independent confirmation and lifecycle policy. Neither truncated inventory nor multiple exact candidates may be relabeled as a completed canonical inventory or an automatic edition choice.
