# MangaAll live preflight — manual and restricted

`node tooling/mangaall_live_probe.mjs --live` runs a **manual-only**
three-source check using public HTTPS APIs: MangaDex, MangaBall and MangaDot.
It is NOT part of standard CI and does not automatically bypass Cloudflare or
capture credentials. It intentionally uses one known work ("Haikyuu!!") and
makes at most eight requests per source, sequentially, no automatic retries.

The probe reports only sanitized per-source outcomes:
- no safe exact match, ambiguous, no chapters, upstream failure,
- number of chapter observations and count of **page metadata**,
- whether every page URL is covered by the source's **current manifest** grants.

It never displays external IDs, URLs, titles, page bodies, image URLs or tokens.
It does not fetch images. Even `observed` **does not prove actual reading**;
a physical Android smoke must still confirm image delivery, ICE reconciliation
and reader progress. A `pagesInsideGrantedOrigins:false` response
explains why `reading.pages@1` remains disabled in these prototypes.

No HTTP redirect is followed. Host grants are enforced per source, and the
probe never contacts external image CDNs. A 403/429 is a failure status, not
an invitation to circumvent the site.

Upstream availability, request policies and attribution must be verified
before running this probe and before signed publication.
