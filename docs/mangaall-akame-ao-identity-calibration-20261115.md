# MangaAll Akame ga Kill! / Ao no Hako identity calibration

Date: 2026-11-15. This is a **test-only** change against the real MangaAll 0.5.2/code7 source adapters. The signed runtime, official index seq33 and provider package remain unchanged.

## Physical evidence vs public API evidence

Galaxy A54 Host `a059a89` physical diagnostics:

- **Akame ga Kill!**: verified cached canonical authors were available, but one candidate was recorded as `AUTHOR_CONFLICT`; the Host also reported `MULTIPLE_PRIMARY_IDENTITIES` (two exact same-name candidates from the requested facet). MangaFire `1wp` was separately visible but was not an eligible requested-language candidate. No edition was automatically bound. **It is not established which specific source creator credit mismatched.**
- **Ao no Hako**: canonical creator bootstrap timed out / later cached metadata remained unverified. The Host observed `Blue Box (Oneshot)` plus two distinct MangaFire HIDs `rjx5q` / `mqm7p`, without evidence establishing edition equivalence. Do not pick an edition by the source chapter count or by display title.

Curated real-source [CI #43712797942](https://github.com/jssantogit/providers-tsuzuki/actions/runs/43712797942) succeeded with four source probes and **42 HTTP requests**: MangaDex 26×200, MangaDot 15×200, MangaFire 1×403 (no challenge bypass or retry). Both Akame and Ao returned two title/alias candidates; Ao's two candidates were from MangaDex itself (`sameSourceRivals=true`). Neither work was promoted to editorial identity, read using an unverified HID, or treated as a complete global lookup while MangaFire was unavailable. `PARTIAL_CANDIDATE_CONFLICT` is an observation, not an assertion that two records are necessarily different editorial editions.

## Independent credit/edition evidence

The publisher Yen Press credits [Akame ga KILL!](https://yenpress.com/series/akame-ga-kill) to **Takahiro (author)** and **Tetsuya Tashiro (artist)**. The physical `AUTHOR_CONFLICT` may therefore be caused by a mismatch between a source record's creator-role classification and the canonical metadata field used for corroboration; the physical log does not expose sufficient author provenance to prove this specific explanation. A verified creator-role comparison should preserve each canonical metadata integration's exact external ID and must not rely on popularity, chapter totals or source title alone.

The Ao no Hako serialized manga is attributed to Kouji Miura. An identically named oneshot is an editorial collision that must remain separately qualified. Even if both works name the same creator, this fact cannot establish an interchangeable edition or Reader chapter mapping.

## Test guarantees

- Added Akame/Ao to the curated corpus: **67** total cases, including **29 manga**, 8 manhwa, 10 webtoon, 7 manhua, 7 light novel and 6 web novel scenarios.
- The regular Provider CI deterministically exercises **54 comic** cases through paginated chapter and Reader URL fixture checks and 13 prose titles for discovery-only boundaries.
- The `identity` opt-in live sample checks Punpun, Koe no Katachi, Akame ga Kill and Ao no Hako; real HTTP responses are sanitized to numerical counts, closed error codes and source IDs/types rather than raw page/creator data.
- Negative scenarios explicitly reject two manga records whose titles/aliases and author match (Ao no Hako and its oneshot), and conflicting writer/artist credits across source candidates (Akame). They do not authorize `reading.chapters` or `reading.pages` for unknown HIDs when ambiguous.
- MangaFire HTTP 403 is **inconclusive** and the source is not challenged repeatedly.

## Still open

The existing provider's MangaDex detail enricher currently requests `includes[]=author` and exposes author relationships; it does not include MangaDex `artist` relationships. Changing published source logic would require a versioned MangaAll release, not silently changing code7. The Host's creator provenance handling is a separate subsystem and may be corrected without rebuilding or republishing code7.

This CI does **not** prove Akame/Ao now have canonical chapters, nor rendered CDN images. Those claims require Host exact identity reconciliation and physical Android evidence on an updated signed APK.
