# MangaAll — generic real-work CI: source lane and Host parity contract

Date: 2026-11-16. Status: **source lane implemented in this PR, Host parity pending**. This document describes both the **current honest capability** and the accepted target; they must never be confused.

## Why the existing CI was insufficient

The offline MangaAll arsenal exercises 67 genuine work *names* against synthetic HTTP bodies. The older opt-in source live matrix imports the real MangaAll JS and queries actual MangaDex, MangaDot and MangaFire APIs, but only checks fixed curated subsets, and never executes the Host's actual Kotlin canonical reconciler/SQLite/Reader. A good API response never means canonical chapters were successfully created. Physical Galaxy A54 code8 showed three distinct states at once: Enen no Shouboutai 315 preferred-source snapshot observations, Tower of God 654 provisional observations with incomplete editorial binding, and Dungeon Meshi original HID `mangafire:52020` plus 200 initial source chapters but `AUTHOR_CONFLICT`. Reproducing **those different decisions** is the goal.

## Implemented: arbitrary real source-work discovery, opt-in

Use [MangaAll generic signed-provider live source journeys](../.github/workflows/mangaall-live-matrix.yml), **Run workflow**, select `custom` and put up to **30 real works** into the `works` input, one per line. No JSON corpus edit, case-specific test, pinned work HID or expected chapter count is required.

Example input (examples only, NOT a fixed test corpus):

```text
Dungeon Meshi
manga :: Enen no Shouboutai
manhwa :: Tower of God
webtoon :: Omniscient Reader's Viewpoint
web_novel :: Shadow Slave
```

Supported explicit format tags: `manga`, `manhwa`, `manhua`, `webtoon`, `light_novel`, `web_novel`. A bare name is recorded as `unknown` — **not assumed to be a manga**. For prose, the current comics-only source is discovery-only and never authorized to produce novel chapter/Reader results. The `batch` selector remains for curated legacy suites and must remain `1` for `custom`.

The workflow divides up to 30 works deterministically among **three bounded jobs** (one-to-ten works each), with no persistent cookies, unauthorized proxies, challenge bypass, image downloads or scheduled source polling. Each job checks the original signed index, rebuilds the precise MangaAll package from the JS under test and compares SHA-256 with the **already published signed archive**. Unsigned candidate code cannot claim that parity. The JS `reading.lookup`, `reading.chapters` and `reading.pages` calls use real source HTTP replies through a reviewed origin-limited bridge, with request/time/response budgets.

For **every work** the JSON artifacts capture the source request status families; per-source candidate count, bounded public HIDs, titles/aliases/authors/locale, detail/coverage status and numeric first-page range; lookup cursor completeness and candidate conflicts; paginated chapter numbers/cursor gaps/duplicate chapter-ID guards; and bounded **read-only per-HID chapter previews** for candidates observed during an ambiguous or incomplete lookup. User-supplied titles and public candidate metadata are reported; no raw request/response bodies, cookies, auth headers, CDN image URLs, page pixels or raw upstream errors are exported. A preview of a rival HID is **not** a preferred edition or a Reader authorization.

### Critical outcome boundaries

- A strict typed lookup failure envelope (e.g. `items=[]`, `lookupFailureCode=HTTP_ERROR`, `nextCursor=null`) means **INCONCLUSIVE**, never a successful empty source. The generic runner's RED test [#43838416393](https://github.com/jssantogit/providers-tsuzuki/actions/runs/43838416393) caught this preexisting incorrect empty interpretation.
- An interrupted/truncated cursor means partial, even if the first page contains chapters and valid image URLs.
- Multiple real source HIDs remain separate; author/name/coverage are diagnostic signals, not editorial selection rules.
- A source blocked by GitHub Actions network (historically MangaFire HTTP403 + `cf-mitigated: challenge`) means `SOURCE_UNAVAILABLE`/inconclusive, not `NO_MATCH`. A54 HTTP200 from another network does not negate that difference.
- The output explicitly carries `canonicalStage=NOT_EXECUTED_HOST` and `readerPixelStage=NOT_EXECUTED_HOST`; `PASS_API` or `SOURCE_JOURNEY_NOT_CANONICAL` cannot be presented as a successful end-to-end Host outcome.

The CLI also has **no-network** `--plan` to validate dynamic case selection and shard allocation. Offline tests here validate parser/sanitizer/protocol invariants. Only workflow `--live` is called a *real source* execution.

## Target v2: exact Host canonical flow over independently sourced real data

The ultimate suite must run **the production Host Kotlin logic**, not reimplement its heuristics in Node. The transport stage and Host stage must share a typed, versioned evidence contract so that a source lookup from MangaAll is handed to the actual `CollectProviderReadingEvidence` / `RefreshChapterEvidence` / canonical reconciliation pipeline and persisted into the Host's normal ephemeral SQLite DB. Each test title needs **independent canonical catalog identity/author metadata from the same real catalog resolver used by production**; a supplied title alone can be catalog-ambiguous and must be reported as such. The input may optionally accept a verified catalog ID in future, but must not require manually coded test cases or assume the first search hit is canonical.

Two execution modes are desirable:

1. **Direct-live Android Host journey:** temporary emulator + original signed MangaAll .tsz + actual isolated provider runtime + actual source HTTP and canonical metadata resolver; verify candidate decisions, per-facet matching, binding safety, page cursors, provisional vs canonical storage, refresh repetition, persisted chapter order and exact Reader source-selection. Android pixels may require separately authorized source CDN requests. If GitHub egress is challenged, report **environment blocked**, not a missing work.
2. **Real-data capture/replay Host parity:** when a source is accessible from an eligible runner, collect immutable, timestamped, provenance-stamped *real normalized Provider V1/V2 envelopes and independent catalog identity*; feed these **unchanged** into the production Host's Kotlin gateway/collectors/SQLite/Reader resolution in Android CI. The capture is not synthetic, but the replay is *not live HTTP* and must be labeled accordingly. Scrub secrets and raw URLs from public artifacts, cap lifetime and validate input hashes/schema. No editorial bindings, candidates, authors or chapter numbers may be invented.

The Host lane should emit a **per-work causal timeline**: requested catalog identity → real aliases/metadata → per-source real candidate HIDs and verification reason → page-by-page source observations → persisted provisional/canonical snapshots → UI query count → selected chapter/Reader page resolution. Include incomplete vs complete flags, explicit reasons (e.g. `AUTHOR_CONFLICT`, `MULTIPLE_PRIMARY_IDENTITIES`, `TIMEOUT`, `PARTIAL_PAGE_LIMIT`), and compare reopened DB state after refresh. Reader metadata/READY cannot substitute for decoded image pixels.

**Acceptance for the ultimate generic CI:** no hardcoded case-specific branches, an arbitrary work input can complete the whole Host pipeline wherever the origin is reachable, tests clearly distinguish verified zero, partial inventories, unsafe ambiguity and upstream outage, and failures are accompanied by enough public IDs/page ranges to reproduce without another APK. Gate code invariants on CI; report mutable upstream outages as environment-specific inconclusive rather than corrupting the build or inventing missing chapters.

## Versioning and rollout

This PR changes **tooling/workflow only**. It does not change MangaAll 0.5.3/code8's signed JS, trust root, index sequence 34, or Host `main`. No new provider publication, no signed APK, and no unverified claim that arbitrary works already went through the Kotlin reconciler. The next engineering work is the generic Host evidence gateway + Android fixture integration, with evidence sourced from actual public requests.
