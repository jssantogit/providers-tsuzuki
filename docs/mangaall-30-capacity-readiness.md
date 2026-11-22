# MangaALL — readiness gate for 30 **real** works (pre-run)

Status: **PREPARATION ONLY**, 2026-11-22. **Do not launch the 30-work live vector until this gate is explicitly accepted**. The published signed P-256 seq36/code10 package SHA256 `bcdfd03ac18c3cfdd0517e08b58dde7efa1f5baa874e93002af28e518860f95f` must not be edited/re-signed/published.

## Audit matrix

| Layer | Observed or enforced capacity | Current readiness |
| --- | --- | --- |
| Operator work selector | 1–30 distinct UTF-8 titles, ≤8192 bytes, ≤180 title chars | Ready: parser preserves input order and format without inventing title, author or HID |
| Provider generic live CI | 3 custom shards, modulo order, 10 works/shard at 30 | Ready for **metadata-only** on-demand execution; no 30-title CI triggered |
| Source metadata request quotas | New per-assigned-work caps: MangaDex & MangaDot max 320 each/shard, MangaFire max80; stops after source challenge | Bounded headroom, **not** a license to ignore HTTP 403/429 or server rate limits |
| CI timeout | 45 minutes per shard, 3 shards maximum in parallel | More headroom, not a performance guarantee |
| MangaDex | Real author/detail checks and source chapter metadata, source delivery may be EXTERNAL MangaPlus | Continue source-bound verification and never promote external chapter as Reader CDN |
| MangaDot chapter HTTP in Provider **test runner** | 2 MiB source bridge (same as original signed JS source adapter); Naruto list 1,628 releases | Larger payloads can be *observed* in diagnostics, not delivered automatically by Host |
| MangaDot chapter HTTP in **production Host** | `ProviderHttpProtocol.MAX_RESPONSE_BODY_CHARS = 192*1024`, `MAX_RESPONSE_JSON_CHARS=256*1024` | **BLOCKER** for Naruto's large root array; original HTTP fails first |
| MangaDot chapter JS result in **production Host** | `ProviderRuntimeProtocol.MAX_RESULT_JSON_CHARS=64*1024`; measured Naruto normalized result 341,751 chars | **BLOCKER** even if HTTP were raised; requires per-page V1 serialization below Host limit |
| MangaDot upstream pagination | `limit=50&page=1/2` and `offset=50` ignored; Bleach list over 2 MiB | **BLOCKER** for large feed; no fake cursor that re-downloads whole body per page |
| Provider runtime process continuity | New QuickJs isolate created and closed for every invoke | **BLOCKER** to in-process source chapter cache or offset-only cursor across calls |
| Provider persistent storage | Disabled in signed code10. When enabled in Host: 64KiB/value, 512KiB/provider total, 256 entries | Any future snapshot cache needs explicit new permission, bounded chunk writes, TTL, concurrency/eviction tests and consent |
| Host canonical lookup | 8 pages/2,000 candidates, incomplete source remains partial | Safety gate must stay. Capacity tests must classify source truncation, not infer empty |
| Host chapter refresh | 32 pages/16,000 observations; supports provisional cursor continuation | A 1,628-row source may fit output pagination in 13 pages at 128/page, but only after safe upstream acquisition |
| Reader | Bleach #336 real CDN pixels PASS on emulator; others not proven | Never infer global 30-work Reader success |
| Source blocking | MangaFire 403/challenge in GitHub CI, HTTP 429 may occur | External limitation: bounded INCONCLUSIVE, no proxy/bot bypass |

## Changes already staged for capacity readiness

`tooling/mangaall_30_capacity.mjs`: pure bounded budget planner, no network. It refuses full 30-title plans unless sharded precisely **3 × 10**; reports **no source/canonical evidence** and known upstream/Host constraints. `mangaall_live_matrix.mjs --plan` now surfaces the exact sharding/maximum request budget without network access. `tooling/test_mangaall_30_capacity.mjs` asserts 30 exact unique work IDs, 3×10 distribution, no lost/duplicated titles, correct source budget, and explicit fail-closed wrong shard counts. Regular Provider CI runs it automatically.

`mangaall-live-matrix.yml` retains **manual/on-demand** real custom vectors (does not accept a 30-run push from this preparation branch), and increases per-shard timeout 22→45min; it still does not claim Android/SQLDelight/Reader proof.

## Work remaining before calling the 30-work corpus production-ready

1. **Source-level feed acquisition for MangaDot**: find a genuinely bounded upstream source endpoint or implement an explicitly authorized Host-managed snapshot/streaming bridge that never moves >64KiB across script result/IPC; validate 192KiB HTTP text limit, 2MiB signed adapter cap, 5-second QuickJs invocation and storage quotas independently. Do not globally lift all protections.
2. **Stable per-source V1 chapter cursors**: keep per-response output ≤48KiB, cursors bound to exact source work ID, language, dataset generation, and monotonic offset. Ensure no duplicate/skip and detect changing inventory/stale snapshot and partial page limits.
3. **Naruto/Death Note editorial identity**: MangaDot numeric HID and title without author/detail is **not** verified edition. MangaDex five MangaPlus external chapters each are not native Reader proof. MangaFire 403 is unavailable, not empty.
4. **30-work workflow**: submit a vetted 30-title list, scope every task to the same three-source Provider, retain independent MangaUpdates identity observation, source/canonical Kotlin/SQLite verdict, and isolated Reader proof; collect outcomes by work ID. Label mixed checks `INCONCLUSIVE_SOURCE` when upstream blocks, not green functional.
5. **Evidence before promotion**: real signed candidate acceptance, then emulator and physical Galaxy A54 sample. New signed package/release requires separate explicit approval, preserving previous P-256 index versions.

No production source changes, image/CDN fetch, new package signature or publication are part of this preparatory capacity PR.
