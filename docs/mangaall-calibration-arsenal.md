# MangaAll calibration arsenal — 65-case v1

Status: **test infrastructure, not a product feature nor proof of reading support**. The canonical index is [`tooling/mangaall_case_matrix.json`](../tooling/mangaall_case_matrix.json). Provider #63 (MangaAll 0.5.2/code7) remains Draft and unpublished; this PR is stacked on it. No new Provider package or key.

## Why

Move source/identity calibration from repeated A54 APK installation to reproducible checks, modeled on the BitChord live MusicBrainz matrix:

- **Deterministic contract gate:** `node tooling/test_mangaall_arsenal.mjs` in normal Provider CI, all 65 cases. Checks schema, naming, source ID provenance, alias/edition false positives, format boundaries, and complete batch coverage.
- **Read-only upstream calibration:** `node tooling/mangaall_live_matrix.mjs --live --output mangaall-live-matrix.json`, one explicitly selected sample on GitHub Actions. Makes actual requests through the unified `app.tsuzuki.mangaall` provider's modules; does not bypass its routing. Host/Android rendering not represented.

| Bucket | Cases | Live batches of up to 4 |
| --- | ---: | ---: |
| Manga (Japanese romanized) | 27 | Core (2 observed HIDs) + manga 1–7 (25 discovery) |
| Manhwa | 8 | manhwa 1–2 |
| Webtoon | 10 | webtoon 1–3 |
| Manhua | 7 | manhua 1–2 |
| Light novel | 7 | prose 1–4 |
| Web novel | 6 | prose 1–4 |
| **Total** | **65** | **All cases addressable** |

Format buckets here are **testing dimensions**, not mutually exclusive taxonomy. Example: a Korean webtoon can also be called manhwa. Prose works share names with comics, but the current MangaAll has no general-purpose prose Reader contract; prose cases are discovery/identity-boundary checks **only**. An identically titled comic hit does not prove novel coverage.

## Verified physical source IDs vs exploratory titles

Only the Galaxy A54 evidence supplies MangaFire `mangafire:zk12` for Oyasumi Punpun / Goodnight Punpun and `mangafire:7p56` for Koe no Katachi / A Silent Voice. The core live suite may inspect their exact source binding, chapter metadata, and first chapter's **page URL metadata**. It never assumes these are already canonical or that images actually render.

All other titles have **no verified Provider work ID**. Their suite makes title/alias lookup only. It does not guess a HID, call `reading.chapters` or `reading.pages` on a guessed ID, create an edition binding, or assert actual format support. To promote one, capture and independently verify the source-scoped ID and editorial identity first.

## Running

**While the workflow lives only on PR #64:** change `tooling/mangaall_live_selection.json` (suite: core/manga/manhwa/webtoon/manhua/prose; batch: 1–7, core requires 1) and commit to the branch. A `push` path filter fires the live workflow. This is intentional opt-in: editing an arbitrary source file will not fan out the 65 cases. GitHub's `workflow_dispatch` button requires the workflow file to exist on the **default branch**; it is **not available for this unmerged feature workflow** (see [GitHub's dispatch requirements](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)). Once separately reviewed and merged, the Actions UI can use the `suite` and `batch` inputs directly.

The output `mangaall-code7-live-api-matrix` contains case IDs, status per stage, bounded request counts/latency, and closed error families. No raw URLs, request bodies, cookies or headers are logged. Locally, run `node tooling/mangaall_live_matrix.mjs --self-test` or, only after opt-in, `node tooling/mangaall_live_matrix.mjs --live --output mangaall-live-matrix.json` with optional `MANGAALL_SUITE` / `MANGAALL_BATCH` overrides.

The branch push job runs **only the selected bounded sample** (core = 2 cases; other suites = up to four per batch), not all 65 live cases. The whole inventory is gated offline in Provider CI. There are no scheduled probes. Keep requests low and respect upstream policies.

## Deterministic code7 JS → Host transport replay

The Provider CI now executes `node tooling/test_mangaall_code7_host_contract_replay.mjs`. This test imports the **actual 0.5.2/code7** `providers/mangaall/main.js` and all three production source adapters, not a mocked reading router. It substitutes **synthetic HTTP response bodies** at the Host bridge only; no MangaFire network, browser challenge bypass, cookies or CDN image bytes.

Its two source-qualified cases are the A54-observed MangaFire IDs `zk12` (Punpun) and `7p56` (Koe). For each it asserts source-side title/alias/author evidence, read-only first-page chapter coverage, legacy no-opt-in behavior, source-scoped chapter identity, page URL/Referer metadata, and rejection of cross-work/cross-source chapter requests. It also checks that a persisted MangaDex/en binding can truthfully return complete zero chapters while independent MangaFire coverage exists, and that MangaFire 403 yields **CHALLENGE_BLOCKED/incomplete**, never an invented complete-empty inventory. Every chapter ID, image URL and positive chapter count in these tests is a **fixture**: only the work HIDs came from prior A54 evidence.

Run with `--export /path/to/code7-replay.json` to emit synthetic, reproducible **JSON outputs from the real JS**, for consumption by Host tests. The [Host Draft #197](https://github.com/jssantogit/tsuzuki/pull/197) Android workflow checks out Provider commit `e74a0ebb43ce27b3a237a80bf9d1c81df1397ee3` **exactly**, executes the replay, generates AndroidTest assets and feeds the resulting base/enriched lookup, chapter and page objects through Tsuzuki's real isolated SCRIPT contract decoder, canonical reconciler and source-scoped Reader resolver. This tests cross-repository **transport compatibility** without copying provider implementations or contacting upstream sites.

**Separate gates remain:** the generated vector is replayed by a local test SCRIPT, not by the signed code7 Android package itself; automatic fallback without rebinding is tested by Host #196's separate domain regressions; the existing continuous ReaderActivity fixture renders local PNG pixels, not remote MangaFire CDN pages. Do not claim signed upgrade, anti-bot transport or physical A54 Reader completion from these results.

## Outcomes and gates

- `PASS_API`: an already verified HID exposed positive source metadata and page URL metadata. **Not** canonical reconciliation or rendered pages.
- `OBSERVED_API_DISCOVERY`: source returned a title/alias match in a discovery-only case. **Not** editorial identity, publication format, novel support, chapter coverage, or Reader authorization.
- `INCONCLUSIVE`: empty/partial lookup, missing evidence, timeout, blocked origin, or unavailable external data; never convert this to zero canonical chapters.
- `FAIL_CONTRACT`: malformed/mismatched source identity/language or disallowed page origin. This fails the live gate; unrelated HTTP failures do not.

Known network limitation (12 Nov 2026): GitHub Actions saw MangaDex and MangaDot HTTP 200, but MangaFire HTTP 403. The pipeline now stops further live MangaFire traffic after first confirmed 403 within a run; it records the blockage without claiming a missing chapter.

Even after live metadata checks pass, **Host #196** must be tested for title/editorial binding, provisional-to-canonical chapter reconciliation, preservation of preferred editions and progress, and Reader identity. One final Android smoke remains essential for rendered images, WebView/Host Browser challenge handling, source switching, and local persistence.

## Expansion policy

Add a case when it covers a distinct failure mode or publication format. Require stable ID, canonical display name, verified aliases where known, category, rationale tags, evidence level and mode. Mark unconfirmed works as hypotheses. Do not pin speculative chapter totals, URLs, or specific IDs. Promote individual works to source-metadata tests only after trustworthy evidence is recorded. Treat every upstream error as dated, not permanent.
