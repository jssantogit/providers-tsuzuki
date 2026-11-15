# MangaAll code8 — real A54 language-facet source routing regression

Date: 2026-11-15. Status: **code8 source fix tested in Provider CI; signed publication/Android acceptance pending**.

## Observed source evidence — not conjecture

Galaxy A54 with Host `efc725b` + signed MangaAll `0.5.2/code7`: `Enen no Shouboutai` produced a completed zero-chapter lookup in one facet. The detailed trace (canonical title ref `ce5378eb728956e427cf160c810af26d`) separately recorded the original MangaFire public title `https://mangafire.to/title/z1r3l-enen-no-shouboutai`, reported language `en`, `VERIFIED_WITH_ALIASES`, rejected as `FACET_MISMATCH` on the other facet. Two `Fan Colored` candidates were excluded as `ALTERNATE_EDITION` in the English search.

This shows a **real cross-facet candidate leak**, but does **not** establish why the English lookup did not also surface the same original HID. There was no observed physical 403 in that capture; do not infer a failed source request or an authoritative source/edition binding.

## Verified root cause and fix

The one MangaAll router `createMangaAllReading.lookup()` called all three internal sources for every Host language request, even though `SOURCE_LANGUAGES.mangafire` only contains `en`. MangaFire's source lookup always labels its hits `en` and ignores `requestedLanguage`. Consequently an `en` source work could leak into the `pt-br` result set (then be rejected by Host), wasting source requests and muddying edition diagnostics.

The code8 candidate now selects only eligible internal adapters for the requested language **before** invocation. Missing language remains compatible with preexisting version-1 callers. A cursor from an ineligible source cannot be reused in a different language, and an unsupported requested language raises an error instead of claiming a completed-empty inventory. MangaDex/MangaDot remain supported for `en` and `pt-br`, MangaFire only for `en`; the same original `mangafire:z1r3l` remains discoverable for an English request.

## Regression results and boundaries

- RED: [Provider CI #43746149605](https://github.com/jssantogit/providers-tsuzuki/actions/runs/43746149605) failed exactly when a real observed `mangafire:z1r3l` candidate appeared in a Portuguese lookup.
- GREEN: [Provider CI #43746279936](https://github.com/jssantogit/providers-tsuzuki/actions/runs/43746279936) passed full conformance with source-language routing, cursor/facet separation and unsupported-language rejection.
- This is a fixture containing **one source-observed real HID**; no fabricated rival works, HIDs or automatic ambiguity resolution.
- The source's English lookup variability, multiple editorial editions, canonical chapter reconciliation and physical Reader/CDN pixels are still open. The published code7 remains immutable. This is an additional source change to **unpublished code8**; revalidate release artifact and trust-root checks before signed publication.
