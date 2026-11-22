# MangaALL future large-chapter snapshot — **NONSHIPPING DESIGN**

**Status:** research and tested offline proof only. Never import this module into the signed code10 Provider. The official P-256 seq36 MangaALL 0.5.5 code10 archive SHA256 `bcdfd03ac18c3cfdd0517e08b58dde7efa1f5baa874e93002af28e518860f95f` remains unchanged.

## Problem

The public MangaDot Naruto work `mangadot:109` returned 1,628 source chapter release rows in one HTTP 200 root array. The current signed MangaDot adapter normalizes all into one `reading.chapters` response (341,751 JS chars). This exceeds the Host script result limit (65,536 chars). Production Host HTTP text is independently limited to **192 KiB**, with an HTTP IPC response limit of 256 KiB; the signed MangaDot JS adapter advertises **2 MiB** text, which does not override the Host broker. For Bleach `mangadot:131`, the upstream list itself exceeds the adapter's 2 MiB cap. Experiments confirmed `limit`, `page`, and `offset` on the current list endpoint are ignored. These facts rule out raising just one limit.

The actual Host `ProviderScriptPackageRuntime.evaluateModule` creates and closes a fresh QuickJs isolate for **every invocation**. Keeping a full array in JS module memory does not preserve pages across calls. The current signed package declares `permissions.storage.enabled=false`. The existing optional `FileProviderStorageHostService` limits each value to **64 KiB**, a whole Provider to **512 KiB**, and 256 entries. Storage access itself requires separate future manifest approval.

## Tested, but not connected, snapshot prototype

`tooling/mangaall_future_storage_chapter_pager.mjs` uses an injected complete-and-verified source-data callback plus injected Provider-style storage `get/set/remove` operations. It is **not** wired to `providers/mangaall`, the runtime, or any published entrypoint.

- Complete, source-verified `HTTP_200_NORMALIZED_VERIFIED` metadata is mandatory. Partial 403/429, oversized upstream, unknown language or missing details cannot become a false empty inventory.
- One active snapshot at a time, TTL **5 min**, max source portfolio 16,000 rows, max saved normalized data **440 KiB**, storage chunks **48 KiB**, no more than 16 chunks. This is conservatively below Host storage quotas. The meta index is committed **last**, and interrupted old writes are cleaned from a bounded fixed key set.
- Every output page contains at most **128** rows and **48 KiB** serialized UTF-8 + JS text; cursor binds exact source HID, language, per-snapshot generation and monotonic position. Foreign/stale/expired/out-of-bounds cursors fail closed. Each part is loaded **once per requested page**, not once per row.
- A normalized 1,628-row **synthetic** portfolio is completely reconstructed across newly created pager instances (simulating one QuickJs runtime per invocation) while fetching source data only once. A separate 30-work sequential rotation evicts the previous snapshot without spilling over 512 KiB. Incomplete source, 6,000-row storage oversize, duplicate/foreign chapter IDs, stale cursors and source/facet switches are rejected.
- This is an **output/continuation proof only**. It cannot accept MangaDot's real HTTP body through signed code10's 192 KiB Host transport, cannot host Bleach's >2 MiB source list, and cannot support two large concurrent portfolios simultaneously without a new storage/cache design. Concurrent replacement yields a safe failure but must still be scheduled/retried under bounded budgets.

## Safe future implementation choices

1. **Preferred:** find an officially supported bounded/paginated chapter-data API or ask the upstream for one; validate on real Naruto/Bleach without fabricating chapter IDs or rescraping forbidden paths. This solves source input, avoids enabling a broad cache permission and scales better.
2. **If source cannot page:** design a dedicated Host-managed text/binary resource snapshot API using existing invocation-scoped 16 MiB binary `getResource` as a starting point. Crucially, current resource handles belong to one invocation and are invalid in the next. A future durable/provider-scoped cache must have quotas, TTL, source origin confinement, keyed generation, isolation, snapshot freshness/eviction and bounded IPC chunking. This is a new Host capability with security review, not a one-line limit increase.
3. **Limited alternative:** enable per-Provider storage only in a separately signed and authorized future package, with the 512 KiB quota honored, and add an approved bounded upstream acquisition method. This may cover Naruto but **not** Bleach or two large simultaneously cached works. Do not expose 2 MiB HTTP text to every Provider by raising global `ProviderHttpProtocol` limits.

Regardless of solution, every row requires source-specific HID and chapter-scoped proof; MangaDot currently has **no verified author/edition metadata** for Naruto/Bleach. Caching a list does not grant a canonical binding or Reader page. End-to-end acceptance needs real Host Kotlin chapter serialization, SQLite per-work evidence correlation, Reader CDN pixels and physical A54 validation; 30-work scale is a later requested test, not a publication gate bypass.

## 2026-11-22 — verified compact source result, still NONSHIPPING

[Real source metrics #45026434781](https://github.com/jssantogit/providers-tsuzuki/actions/runs/45026434781) processed both full public MangaDot chapter JSON arrays with no raw export:

| Exact unverified source HID | Real source rows | Normalized chapter chars | Lossless compact tuple-array chars |
| --- | ---: | ---: | ---: |
| Naruto `mangadot:109` | 1,628 | 340,094 | 106,212 |
| Bleach `mangadot:131` | 4,341 | 939,458 | 312,704 |

The compact tuple preserves the existing adapter's source chapter identifier, number, uploads-vs-chapters kind, title, facet, group and release timestamp. A regression invokes the **real signed code10 MangaDot source adapter** with synthetic HTTP and proves exact normalized record parity, including rejecting unexpected fields and mismatched labels instead of silently dropping data.

The **nonshipping** `mangaall_future_storage_chapter_pager.mjs` supports an *optional lossless* encode/decode codec and a **256-item maximum** while independently enforcing the unchanged **48 KiB JSON output**, **64 KiB/value**, **512 KiB/provider** and **32 Host pages** constraints. It tests a synthetic 4,341-row Bleach inventory across fresh test-runtime instances, one source fetch, committed storage chunks, rehydration of all IDs, no duplicate/skip and foreign-cursor rejection. The original full-JSON normalized storage form still FAILS the 512KiB storage quota as expected.

This **does not provide the Android Host production HTTP streaming API**. Public code10 has HTTP text body limited to 192KiB, script return 64KiB, original source adapter 2MiB, storage manifest permission disabled, and a fresh QuickJs isolate per invocation. A separate future *reviewed* API and manifest permission are required before any product use. The prototype has one active snapshot per Provider: concurrent work refreshes still need strict serialization/locking, not silent eviction. MangaDot source work IDs remain unverified editorial identities.
