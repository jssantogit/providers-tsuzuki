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

## Attribution

Parts of the current API/VRF behavior were implemented with reference to the Apache-2.0-licensed MangaFire extension in `keiyoushi/extensions-source`. The Tsuzuki implementation is substantially reworked for SCRIPT Provider contracts and host-mediated services. See `assets/THIRD_PARTY_NOTICES.txt`.
