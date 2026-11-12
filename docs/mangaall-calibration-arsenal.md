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

Open GitHub Actions → **MangaAll 0.5.2 live API matrix** → **Run workflow** on the PR #64 branch. Select one `suite` (core, manga, manhwa, webtoon, manhua, prose), and one `batch` (1–7; core requires 1). The output `mangaall-code7-live-api-matrix` contains case IDs, status per stage, bounded request counts/latency, and closed error families. No raw URLs, request bodies, cookies or headers are logged. Scripts can also be run locally in a reviewed environment with the same opt-in and `MANGAALL_SUITE` / `MANGAALL_BATCH` environment variables.

The branch's push workflow only runs the 2-case core sample, not the full 65-case live matrix. The broader runs require explicit selection. There are no scheduled probes. Keep requests low and respect upstream policies.

## Outcomes and gates

- `PASS_API`: an already verified HID exposed positive source metadata and page URL metadata. **Not** canonical reconciliation or rendered pages.
- `OBSERVED_API_DISCOVERY`: source returned a title/alias match in a discovery-only case. **Not** editorial identity, publication format, novel support, chapter coverage, or Reader authorization.
- `INCONCLUSIVE`: empty/partial lookup, missing evidence, timeout, blocked origin, or unavailable external data; never convert this to zero canonical chapters.
- `FAIL_CONTRACT`: malformed/mismatched source identity/language or disallowed page origin. This fails the live gate; unrelated HTTP failures do not.

Known network limitation (12 Nov 2026): GitHub Actions saw MangaDex and MangaDot HTTP 200, but MangaFire HTTP 403. The pipeline now stops further live MangaFire traffic after first confirmed 403 within a run; it records the blockage without claiming a missing chapter.

Even after live metadata checks pass, **Host #196** must be tested for title/editorial binding, provisional-to-canonical chapter reconciliation, preservation of preferred editions and progress, and Reader identity. One final Android smoke remains essential for rendered images, WebView/Host Browser challenge handling, source switching, and local persistence.

## Expansion policy

Add a case when it covers a distinct failure mode or publication format. Require stable ID, canonical display name, verified aliases where known, category, rationale tags, evidence level and mode. Mark unconfirmed works as hypotheses. Do not pin speculative chapter totals, URLs, or specific IDs. Promote individual works to source-metadata tests only after trustworthy evidence is recorded. Treat every upstream error as dated, not permanent.
