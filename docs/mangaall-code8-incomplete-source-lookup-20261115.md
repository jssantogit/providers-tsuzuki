# MangaAll 0.5.3/code8 — bounded source retry must not certify a complete empty lookup

Date: 2026-11-15. Status: **candidate code8 green in Provider CI; not signed/published or physically validated**.

## Real A54 trigger versus proven code defect

Physical Host `efc725b` with signed MangaAll 0.5.2/code7 produced 372 successful MangaFire HTTP responses (no observed 403). An `Enen no Shouboutai` refresh ended with zero and `completed=true`; the English matching set exposed only Fan Colored variants, while the other facet's lookup also displayed an original MangaFire candidate `z1r3l` with `language=en`, which the Host correctly rejected **for that facet**. This is evidence of a missing/ineligible candidate, **not proof** that a specific MangaFire lookup failed or that `z1r3l` is automatically the chosen edition. The CI runner's 403 challenge is a separate environment.

Inspection of the unified router uncovered an independent deterministic defect: when source A failed once, the router retained its cursor with retry flag `r=1`. If source A failed **again** while another source had succeeded, its exhausted failure was omitted from the remaining cursor and the aggregate returned `nextCursor=null`, wrongly certifying an exhaustive search. An app can then classify a zero-matching-candidate result as genuinely complete.

## Change

In `providers/mangaall/modules/router.js`, after both attempts on any internal source fail, return the existing typed lookup failure envelope (`items=[]`, `nextCursor=null`, closed `lookupFailureCode` and an optional safe HTTP status). Preserve the previous typed `allSourcesFailed` handling. Do not issue a third retry or emit raw upstream errors/URLs. Healthy source items from **previously completed cursor pages** remain available to the Host as partial lookup salvage; any successful data on the *same terminal page* is not returned in the failure envelope because the strict Host V1 decoder forbids mixed success+failure. That bounded conservative behavior is intentional.

The Host already converts source failure envelopes to `SOURCE_READ_ERROR` and treats salvageable prior pages as `complete=false`. Incomplete evidence may be retained, **but is not sufficient to auto-bind an edition or claim a full canonical chapter count**.

## Regressions

- RED Provider CI [#43739376251](https://github.com/jssantogit/providers-tsuzuki/actions/runs/43739376251): test failed with a successful-looking terminal cursor after exhausted source.
- GREEN Provider CI [#43739801300](https://github.com/jssantogit/providers-tsuzuki/actions/runs/43739801300): full Provider conformance, 67-case *offline synthetic-transport* arsenal, actual code8 JS replay, manifest/Reader-contract gates, immutable archive and signed-index verification pass.
- Tests also assert the successful one-retry recovery path, exactly two attempts for a permanently failing source, and closed HTTP503 failure in an `Enen no Shouboutai` transport **hypothesis** with no fabricated candidate identities. This is not a claim of a real 503 on A54.

## Version and rollout boundaries

Published signed MangaAll 0.5.2/code7 and index sequence 33 are immutable and unchanged. The candidate source manifest advances to 0.5.3/code8, retaining the exact Provider ID, facets, caps, origins, root identity and rollback. The normal CI performs a **non-signing** simulated next-index delta to sequence 34; it does not publish code8. Do not confuse source `main` merge with signed installation.

No change to MangaFire VRF/API transport, author corroboration, source-edition selection, provisional→canonical reconciliation or Reader pixels. Next meaningful action: verify new Host/source candidate behavior on chapter-zero and incomplete lookup cases; investigate creator provenance for Dungeon Meshi and cross-facet candidate availability for Enen using actual HID evidence, then a single signed provider upgrade when release gates are satisfied.
