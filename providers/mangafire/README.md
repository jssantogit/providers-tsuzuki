# MangaFire Provider

Provider ID: `app.tsuzuki.mangafire`

This is an independent Tsuzuki-native implementation of MangaFire's current JSON reading surface. It is intentionally small so it can serve as the first real repository/install/QuickJS/Reader acceptance Provider.

## Capabilities

- `reading.lookup@1`: title lookup through `/api/titles`
- `reading.chapters@1`: paged chapter inventory through `/api/titles/{id}/chapters`
- `reading.pages@1`: page URLs through `/api/chapters/{id}`

The MangaFire API signs `/api/*` requests with a `vrf` query parameter. The signing transform is implemented in ordinary JavaScript inside the Provider; no native escape hatch is required.

HTTP is attempted first. A bounded Browser Host Service request is used only as a fallback when the normal request is challenged. If physical acceptance proves the current Browser Host Service is insufficient for MangaFire's active challenge mode, that is treated as a reusable Provider-platform requirement rather than adding MangaFire-specific privilege to the app.

## Scope

V1 exposes only the English content facet. Additional MangaFire languages can be enabled after the first physical Reader path is accepted.

## 0.1.6 signed smoke acceptance (2026-10-31)

The signed repository index is at sequence **24** and publishes MangaFire
`0.1.6` (version code **7**). The `reading.lookup` flow now accepts only
MangaFire-attested alternate titles; an explicit HTTPS `mangafire.to/title/{hid}-...`
link must resolve to the matching source record. Explicit per-chapter languages are checked before variant selection to prevent importing Spanish records into the English facet. Chapter pagination does
not report a complete inventory when the upstream omits its termination metadata. The
source is now requested with `sort=number&order=asc` so a timeout after early
pages favors chapters 0–5 rather than the most recent 150+. This ordering
request must still be verified against live upstream behavior on-device.

The automated conformance fixtures and signed publication are **not** physical
evidence of chapter availability. For issue
[Tsuzuki #169](https://github.com/jssantogit/tsuzuki/issues/169), the pending
in-place Android smoke must:

1. Refresh the already-trusted Provider repository (no data reset), then
   verify that MangaFire reports version code 7.
2. Install the signed Release Host build from the
   [dedicated smoke workflow](https://github.com/jssantogit/tsuzuki/actions/runs/41195392665)
   over the existing app; do not substitute a Dev package.
3. Verify explicit edition URLs for Boku normal (`kkvk9`) and colored
   (`np3ln`) remain distinct, and verify Kimetsu (`7j6`) and
   Nanatsu (`gry`) against the source titles.
4. Observe sanitized per-page counts and the complete/partial result;
   verify no stale canonical support is detached on a page failure.
5. Open a real chapter in Reader, verify actual page bytes, and confirm
   library/progress persistence across the app update.

Do not close #169 based only on fixtures or HTTP 200 responses. The Host
selection PR remains unmerged until these acceptance checks are recorded.

## Attribution

Parts of the current API/VRF behavior were implemented with reference to the Apache-2.0-licensed MangaFire extension in `keiyoushi/extensions-source`. The Tsuzuki implementation is substantially reworked for SCRIPT Provider contracts and host-mediated services. See `assets/THIRD_PARTY_NOTICES.txt`.
