# MangaFire: CI-only 403 diagnostic, 2026-11-15

## Evidence observed (not a workaround)

Source: [one-shot diagnostic #43716043952](https://github.com/jssantogit/providers-tsuzuki/actions/runs/43716043952), commit `4b955140`; [Provider CI #43716043896](https://github.com/jssantogit/providers-tsuzuki/actions/runs/43716043896), SUCCESS.

Two public **GET** calls with the same Node 22 GitHub Actions runner, no redirects, no cookies, no browser session, no user identity, no challenge solving:

| Request | HTTP status | Content response marker |
| --- | --- | --- |
| MangaFire homepage `/` | 403 | `cf-mitigated: challenge` |
| MangaFire signed `/api/titles` | 403 | `cf-mitigated: challenge` |

Outcome: **`UPSTREAM_CHALLENGE`**. The challenge is presented to the CI runner for an *ordinary homepage request*, before any MangaAll work lookup or chapter pagination. This finding **does not** establish that the VRF signature is rejected, or that MangaFire is unavailable from the Galaxy A54. A signed API endpoint returning 403 cannot authorize an empty candidate list, an absent chapter inventory or a canonical work match.

The production MangaAll 0.5.2/code7 VRF transform was compared with the [current keiyoushi MangaFire VrfSigner](https://github.com/keiyoushi/extensions-source/blob/main/src/all/mangafire/src/eu/kanade/tachiyomi/extension/all/mangafire/VrfSigner.kt): all three published substitution tables, keys and IVs match. This is a static transform comparison, **not** proof of an accepted API request or compatible current HTTP headers.

## Important execution boundary

The MangaAll adapter's `apiJson` first uses the Provider's signed HTTP route. For a 403 or HTML challenge it requests the **Android Browser Host Service** and accepts only parsed JSON. The opt-in `tooling/mangaall_live_matrix.mjs` uses the Node HTTP bridge, which **does not provide that Android Browser service**. Therefore its MangaFire 403 measures one runner's raw HTTP reachability, **not the full Android Provider code7 flow**.

In the Host the `AndroidProviderBrowserHostService` is a bounded, isolated WebView-based text read. It does not provide an interactive UI to complete a source challenge. Its existence alone cannot guarantee that protected content loads. Browser challenges or inaccessible subresources must never be interpreted as successful page reads.

Separately, the latest physical Galaxy A54 smoke recorded several MangaFire **Reader READY** sessions (resolved page URLs), which is useful evidence that the source can sometimes be reached from the device, but does **not** prove CDN bytes or pixels were rendered.

## What changes with this diagnostic

- Add `tooling/mangafire_access_probe_core.mjs`, with explicitly typed distinctions among `UPSTREAM_CHALLENGE`, `SITE_AND_API_DENIED`, `API_ONLY_DENIED`, `TRANSPORT_UNAVAILABLE`, `SIGNED_API_HTTP_AVAILABLE`, and `INCONCLUSIVE_HTTP`.
- Offline tests use mocked **transport only**, not invented manga candidates. They check redirect/cookie restrictions, real signed URL generation, typed failure semantics and that raw HTML, signed URLs, titles, credentials and upstream exception messages do not reach the report.
- The one-shot network workflow reads only HTTP status and the closed challenge header, then stores a bounded JSON artifact for 14 days. **No content bodies, images, cookies or source records** are downloaded or published.
- Existing signed `app.tsuzuki.mangaall` 0.5.2/code7 and official source index seq33 remain unchanged. No Host APK is built.

## Next required experiment: MangaFire from a legitimate device session

**Do not fan out the 67-work ambiguity arsenal while MangaFire is blocked in the CI runner.** On a signed Android Host with the installed MangaAll, first verify a source route for one already physically observed HID (Punpun `mangafire:zk12` or Koe `mangafire:7p56`) and inspect closed diagnostic outcomes for: direct HTTP, Browser Host fallback, source chapter page, Reader URL metadata and actual image rendering. If the source requires an interactive challenge, the user must complete it through the site's ordinary browser experience; no automated challenge bypass, shared login cookies, scraping around origin restrictions, or proxy rotation.

Only after a successful real source response may a separately reviewed opt-in capture record **genuine, minimally necessary provider response metadata** (source-scoped HID, selected title/alias, author/detail evidence, chapter pagination/cursor count, image URL origin-class, timestamp and source request outcome) without cookies/tokens/image payload. Those recordings can later feed deterministic **real-data** replay tests, against the true Host reconciliation and Reader policy, with complete/incomplete flags retained. Never infer chapter totals from partial lists or editorial equivalence from matching titles.

**Status:** root cause of **GitHub Actions 403** identified as an upstream challenge; access to MangaFire through CI remains blocked. Replaying live MangaFire data is not yet possible from this runner. No claim of an actual MangaFire site fix or physical Reader acceptance is made.
