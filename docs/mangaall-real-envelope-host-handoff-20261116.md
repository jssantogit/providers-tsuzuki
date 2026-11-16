# MangaAll real normalized envelope capture — Host parity bridge (stage 1)

2026-11-16. **Implemented: read-only real Provider source envelope handoff; Host Kotlin/SQLite/Reader NOT executed yet.** Follows [Tsuzuki #207](https://github.com/jssantogit/tsuzuki/issues/207) and the generic source runner merged in Provider #70.

## Where it runs

The existing opt-in [MangaAll live matrix](../.github/workflows/mangaall-live-matrix.yml) accepts arbitrary `suite=custom` work titles. After validating the **current signed MangaAll 0.5.3/code8 archive SHA against signed index sequence 34** and the byte-equivalence of packaged JS to published .tsz, it now runs:

```
node tooling/mangaall_live_matrix.mjs --live \
  --output mangaall-live-matrix-0.json \
  --real-envelopes mangaall-real-envelopes-0.json
```

The **same real** `reading.lookup`, `reading.chapters`, and `reading.pages` calls consumed by the source journey go through a passive observer. No synthetic candidate, author, chapter, work HID, cursor, edition or extra upstream request is created by the recorder. Every work has its own sequence of observed request/response envelopes and the source's exact real `providerChapterId`, `rawNumber`, `rawLabel`, volume, scanlation group, release time, full work title, aliases, public work URL, author, coverage and source cursors where safe. Explicit returned `lookupFailureCode` remains `SOURCE_FAILURE` even if it has an empty list and null cursor. Thrown upstream calls remain `SOURCE_ERROR`; no failed call is converted to successful zero.

Each work record is bounded (128 calls / 2.5 MB), hashed SHA-256 over its exact recorded normalized content, attributed to `caseId`, timestamp, signed package digest and version. The batch also includes an integrity hash, selected shard and signed index sequence. **The hash detects modifications, but does not constitute an independent catalog attestation or a cryptographic signature from MangaFire.** Runtime pass-through preserves what the real Provider delivered to the source probe. Existing per-source HTTP summary remains a separate diagnostic, including up to 403/challenge classification.

Public CI artifacts are separately named `mangaall-real-source-envelopes-<shard>` and retained **3 days**; normal source summaries retain 14 days. Only a reviewed source work URL on the MangaFire/MangaDex/MangaDot public title domain is exported. **Raw HTTP bodies, headers, cookies, authorization, CDN page URLs, query strings and image pixels are never exported.** A `pages` record includes only type and count, explicitly `READER_URLS_REDACTED`, not a replayable Reader result. A rejected text, unknown Provider DTO field, oversized response, rejected cursor or limit overflow marks the capture `INCOMPLETE_REJECTED_FIELDS`/`INCOMPLETE_BUDGET_EXCEEDED` instead of claiming exact replay.

## Consumer contract (next Host slice, not implemented here)

- The Host must **verify** the batch SHA-256, per-case SHA-256, signed provider digest, schema, allowed ID/URL shapes, monotonic sequence, cursor and limits before importing.
- A source-only title from user input has **no canonical catalog identity or independent author provenance**. Host must resolve it via the same production catalog integration (or report `CATALOG_AMBIGUOUS`/`CATALOG_UNAVAILABLE`) before invoking **production** `CollectProviderReadingEvidence`, `RefreshChapterEvidence`, `ReconcileChapterEvidence` and disposable SQLite query.
- Runtime replay via recorded **lookup and chapter** envelopes is `CAPTURED_REAL_PROVIDER_REPLAY`, not direct live HTTP; no fabricated response is allowed. Empty Source failure/403/challenge/cursor truncation means incomplete, never `NO_CHAPTERS`. Any record that is `INCOMPLETE_*` fails closed as a *source capture*.
- Reader/page metadata is deliberately not replayable without private CDN URLs. Reader pixel test needs separately authorized live network or local fixture explicitly marked **synthetic**, and must not be presented as a real content acceptance result.
- No auto-bind to a preferred edition on first/most popular candidate, no inferred author, and no modifications to published provider code, manifest, trust root or package files. The sole result in this step is an **accurate bounded handoff**, not canonical/Reader acceptance.

See [generic real source CI](mangaall-generic-real-work-ci-20261116.md) and [Host issue #207](https://github.com/jssantogit/tsuzuki/issues/207).
