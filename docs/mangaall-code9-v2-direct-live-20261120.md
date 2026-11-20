# MangaAll 0.5.4/code9 — manual direct-live V2 diagnostic (NOT a signed Host test)

**Status: source-level probe prepared, offline safety tested; direct-live results are not asserted.** The canonical Provider source is `0.5.4/code9` with `publication=release`, but the *official P-256 signed index remains at sequence 34/code8*. No code9 .tsz is signed or officially installed until a separately authorized publication.

## Purpose

The older `mangaall-live-matrix.yml` deliberately requires that its tested JS is byte-identical to the *already published signed* package. After code9 source promotion, it cannot safely label code9 network responses as evidence from a signed Provider.

The separate **manual-only** workflow
`.github/workflows/mangaall-code9-v2-direct-live-diagnostics.yml`
tests the newly promoted code9 source over actual upstream HTTP with a radically different provenance label:

`MANGAALL_CODE9_UNSIGNED_READ_ONLY_LIVE` / `DIRECT_LIVE_RUNNER_UNTRUSTED_CODE9`.

The workflow requires explicit manual acknowledgement `I_ACCEPT_LIVE_READ_ONLY` and a JSON array of 1–3 titles (e.g., Naruto, Death Note, Bleach). Every title is queried by **one MangaAll router** that contacts MangaDex, MangaDot and MangaFire within the *same lookup*, then follows at most two further cursor pages. One source failing does not erase observations from another.

## Controls

- Before any network request, verify the **existing signed code8 index** with `tooling/verify_index.mjs`. Rebuild the code9 canonical source and compare the .tsz bytes exactly against the audited `review/mangaall-code9` overlay. This is *source authenticity and reproducibility*, **not a code9 signature**.
- The Node HTTP service uses the existing reviewed strict bridge and allowlists **only** `https://api.mangadex.org`, `https://mangadot.net`, `https://mangafire.to` with bounded requests (12 per origin), no automatic redirects, 12-second timeout and 2 MiB response cap. No cookies, user authentication, browser service, challenge bypass, image/CDN download or arbitrary origin.
- The actual `providers/mangaall/main.js` executes V2 with `diagnosticsVersion=2` and English facet. Results expose **source statuses, bounded failure codes, HTTP status and candidate counts** only. Neither candidate IDs nor raw response bodies, image URLs, headers, cookies or tokens are saved.
- A source HTTP 403 remains `CHALLENGE_BLOCKED` and incomplete; one bounded source-only retry can be observed. Mixed source results are **not** silently promoted to canonical/Reader, and complete first-page statuses remain `FIRST_PAGE_COMPLETE_UNCORROBORATED` (not `NO_MATCH_ATTESTED`).
- Uploaded report is retained only three days. Source/network runner failures must be labeled **inconclusive**, not interpreted as absent works, missing chapters, or Reader-ready.

## Acceptance and limitations

Provider CI runs `node tooling/test_mangaall_code9_live_v2.mjs` against **synthetic fetch only**, verifying source fan-out, safe input, denied origins, fail-closed contract spoofing, 403 attribution, retry budget and lack of Reader/canonical grants.

This workflow does **not** automatically run in CI or on commits, does **not** sign the index, does **not** exercise the Android Host, and can never prove real Reader/CDN pixel rendering. A manual execution after source review may provide corroborating **network reachability** evidence, but may legitimately be inconclusive if upstream challenges block GitHub Actions. No source challenge is bypassed.

The separate [Provider signed-release audit](../.github/workflows/mangaall-code9-signed-acceptance.yml) and [Host signed-install Android acceptance](https://github.com/jssantogit/tsuzuki/blob/main/.github/workflows/mangaall-code9-official-signed-install-android.yml) remain blocked until the operator authorizes a genuine official signed-index publication of code9 sequence 35.

Refs [Provider issue #72](https://github.com/jssantogit/providers-tsuzuki/issues/72), [Host #207](https://github.com/jssantogit/tsuzuki/issues/207).
