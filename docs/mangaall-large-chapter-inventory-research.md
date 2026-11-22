# MangaALL — Large chapter inventories (post-code10 research, **not a release**)

**Status:** Research and offline prototype only (2026-11-22). The official P-256 signed MangaALL 0.5.5 / code10 / sequence36 archive SHA256
`bcdfd03ac18c3cfdd0517e08b58dde7efa1f5baa874e93002af28e518860f95f`
**must stay byte-identical**. This document does not authorize a code11 signature, publication, automatic editorial binding, or migration of end-user data.

## Grounded observations

| Observation | Evidence | Correct inference |
| --- | --- | --- |
| Code10 real MangaDex Bleach #336 CDN transport decoded 2 images on Android | [Host #44979904854 attempt 2](https://github.com/jssantogit/tsuzuki/actions/runs/44979904854) | One selected source chapter is fetchable; not all Bleach chapters |
| Real CDN image visibly rendered in `ReaderActivity` on emulator | [Host #44984452102](https://github.com/jssantogit/tsuzuki/actions/runs/44984452102) | Reader pixels on emulator, not physical Galaxy A54 |
| Real combined Naruto/Death Note/Bleach Host Kotlin+SQLite, five jobs green | [Host #44985770101](https://github.com/jssantogit/tsuzuki/actions/runs/44985770101) | Infrastructure contract passes; 3 works remain `INCONCLUSIVE_SOURCE` for canonical binding |
| Naruto MangaDex 5 source chapter observations; Death Note 5 | [Host #44985083695](https://github.com/jssantogit/tsuzuki/actions/runs/44985083695) | MangaPlus **external** chapters, not native CDN Reader or canonical edition grants |
| MangaDot Naruto candidate `mangadot:109` returns 1,628 source chapter release rows, chapter numbers 1 to 700.6, HTTP 200 JSON root array | [Provider #45016848436](https://github.com/jssantogit/providers-tsuzuki/actions/runs/45016848436) | Source-level read-only metadata; no author/edition verification; rows are not distinct canonical chapter count |
| Normalized code10 JS result for those 1,628 rows contains **341,751 UTF-16 chars**, **341,993 UTF-8 bytes** | [Provider #45017205045](https://github.com/jssantogit/providers-tsuzuki/actions/runs/45017205045) | Exceeds Host `ProviderRuntimeProtocol.MAX_RESULT_JSON_CHARS=65,536`; HTTP alone is not a working Host chapter result |
| MangaDot Bleach `mangadot:131` chapter-list body exceeds 2 MiB signed adapter limit | [Provider #45016848436](https://github.com/jssantogit/providers-tsuzuki/actions/runs/45016848436) | The current source cannot import its complete chapter list; never infer zero chapters |
| `limit=50&page=1`, `limit=50&page=2` and `limit=50&offset=50` return unchanged **1,628** Naruto rows; Bleach remains >2 MiB | [Provider #45017384702](https://github.com/jssantogit/providers-tsuzuki/actions/runs/45017384702) | These three pagination forms are **ignored** by the current endpoint. Do not invent server pagination. |
| MangaFire plain CI HTTP remains 403/challenge | [Host #44985770101](https://github.com/jssantogit/tsuzuki/actions/runs/44985770101) | Partial blocked source, not empty corpus; no bypass |

The current source `providers/mangaall/modules/sources/mangadot/modules/mangadot.js` obtains the entire `/api/manga/:id/chapters/list?lang=en` JSON array in one call and returns all normalized observations in **one** `reading.chapters` reply with `nextCursor=null`. The HTTP source adapter itself caps the body at 2 MiB, while the Host runtime caps each script result to 65,536 JSON chars. Both constraints are intentional.

The Host `RefreshProviderReadingChapters` also caps one refresh at **32 pages** and **16,000 observations**. The collector imposes per-source and outer deadlines; repeated full-list upstream downloads on every output cursor would be unacceptable for reliability, timeouts and rate limits.

## Design work required for a future version

1. **Obtain a bounded upstream feed.** Independently verify an actual source-supported paginated/filterable chapter endpoint, or another reviewed public API route yielding the same source-scoped chapter IDs with stable page ordering. The tested `page/offset/limit` parameters **do not work** on `chapters/list`. Do not pretend a full-body 2–4 MiB download is pagination, and do not bypass rate limits/Cloudflare.
2. **Output cursors independent of upstream pagination.** Each `reading.chapters` response must fit below the Host's 64KiB char envelope with margin (suggested target at most **48 KiB** including `nextCursor`). The cursor must be bound to source work HID, language/facet, ordered inventory snapshot/version and monotonic position. Reject unrelated, stale, cyclic, or oversized cursors; never repeat/drop source chapter rows silently.
3. **Efficient continuity across calls.** Do not re-download an entire 1,628-row (or larger) chapter list for each 128-row output page. Obtain source paging or a reviewed bounded cache/continuation mechanism with appropriate freshness and isolation. A cache must not convert a partial/failed inventory into a completed one.
4. **Edition authority is separate.** MangaDot search currently returns a title and numeric HID but not independently verified creator metadata; `mangadot:109` and `mangadot:131` are **unverified source candidates**. Chapter observations alone must not match them to canonical MangaUpdates editions or authorize Reader options. Verify author, work identity, language, format, scanlation attribution and edition equivalence before automatic binding.
5. **Failure is not emptiness.** More-than-2MiB, HTTP 403/429, runtime timeouts, missing source metadata and max-page exhaustion must emit bounded `INCONCLUSIVE`/partial diagnostics, preserving previously accepted evidence. No fallback to unsafe HTML/bot challenges.

## Offline-only page output contract prototype

`tooling/mangaall_experimental_chapter_output_paging.mjs` is a **nonshipping sketch**, **not wired to any signed Provider**. Its adversarial tests run in normal Provider CI via `tooling/test_mangaall_experimental_chapter_output_paging.mjs`:

- Source-scoped, facet-bound, monotonic `c1` cursor; 128 items/page maximum and **48 KiB UTF-8/JS character** serialized output target. Rejects invalid/foreign/replayed/out-of-bounds cursors and duplicate/foreign chapter IDs.
- Proves a **synthetic** 1,628-row array can be serially reconstructed within the Host's 32-page limit, without skipping or duplicating rows.
- Proves 6,000 synthetic source rows **cannot** be silently labeled complete at a 32-page boundary. Cursor remains non-null and the Host must use its explicit provisional cursor progress policy.
- **Does not** solve large upstream response downloads, dataset changes between invocations, author authority, or real Android Reader delivery.

## Acceptance gate before any future signing/publishing

A prospective next version must demonstrate exact original source-work and chapter identity at every step, no missing author/edition corroboration, real source response pagination and Host V1 serialization under limits, true SQLDelight persistence and correlation, and live Android CDN **pixels** in the actual Reader. Repeat the integrated **three-source** Naruto/Death Note/Bleach smoke before expanding the work vector to 10–30; then test on a real Galaxy A54. Preserve prior signed versions and supply-chain index history. Signature/publication requires distinct explicit operator approval.
