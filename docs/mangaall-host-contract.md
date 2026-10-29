# MangaAll — source routing and Host V1 contract (2026-10-29)

Status: **initial implementation / architectural spike**, not ready for publication.
Product name and minimum seven-source scope are approved by the user.
A simultaneous multi-source runtime contract has **not** yet been selected or approved.

## Intent

Offer one discoverable MangaAll experience while preserving the independently
maintained MangaFire provider, the Tsuzuki canonical work identity, and opt-in
network capabilities. Every source must retain its own provenance, permission,
availability and failure status. MangaAll must not turn chapter numbers into
authoritative editorial chapter identities.

## Ground truth from existing code

- MangaAll SCRIPT provider identity: `app.tsuzuki.mangaall`.
- `CollectProviderReadingEvidence.readingTargets()` enumerates enabled SCRIPT
  providers with reading.lookup and reading.chapters capabilities, then facets.
- `CollectProviderReadingEvidence.discoverBinding()` selects exactly one
  normalized title/alias match per provider + facet; if zero or ambiguous, no
  binding is published.
- `ProviderReadingBindingRepository.get(canonicalTitleId, providerId, facetId)`
  tracks only one binding in that scope; an external work ID is **not**
  another source-isolation dimension in the lookup key.
- Current SCRIPT grants are manifest-wide `network.origins` and
  `browser.origins`. A JavaScript-internal toggle cannot enforce per-source
  privilege revocation in the Host.
- `PROVIDER_PROVISIONAL` observations can inform ICE when supported by the
  current Host branch, but never assert an editorial publisher or guarantee
  Reader pages.

## What this PR does

- Declares all seven source descriptors as a planned coverage matrix.
- Enables only the MangaDex experimental evidence adapter within MangaAll.
- Supports title aliases, stable prefixed work/chapter IDs, en and pt-br chapter
  feeds, bounded cursors, safe failure on unexpected protocol responses.
- Supplies no Reader delivery and no permission for unrelated HTTP sites.
- Runs fixture tests and repository/package conformance without publishing.

## The unresolved multi-source contract

Activating multiple sources under a single provider/facet makes two correct
title matches ambiguous; the Host can then bind neither. Using an arbitrary
source prefix in the external ID does not fix the Host repository lookup key.
The current two language facets do not solve this collision either.

**Option A — extend Host with stable source-qualified binding identities:**
a source key must participate in (title, provider, source, language/facet)
binding persistence, consent, provenance, cancellation, routing and chapter
refresh snapshots. Migrations/backups must preserve existing IDs and grants.
Host must independently authorize each network origin and avoid cross-source
fallback without explicit edition validation.

**Option B — use independent child Provider IDs for individual sources, with a
unified MangaAll discover/install view:** leverages current Host origin grants
and unique binding keys, but requires UI grouping and careful repository
installation and updates. Shared JS libraries may reduce duplication without
conflating runtime authority.

The correct implementation should preserve the single *user-facing MangaAll*
experience without simulating security isolation in JavaScript. Do not pick
option A or B by default or enable more sources until evidence and explicit
architecture review establish the least disruptive contract.

## Safety and release gates

- Existing repo ID/signature/sequence and installed MangaFire package are
  untouched. No migration, no Main-branch publication in this PR.
- Runtime source attribution must remain visible; MangaDex requires attribution
  and restricts monetized API applications; chapter reading additionally
  requires scanlation credit and honoring group takedown requests. Confirm
  project distribution/compliance before any signed publication.
  Official documentation: https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md
- Manga Livre.to, MangaBall, MangaDotNet, AnimeXNovel, MangaFlix and MangaFire
  as a MangaAll subsource remain **planned and non-executable**. Confirm service
  identity, supported languages, legitimate transport and terms separately.
- Separate `lookup`, `chapters`, and `pages` capability claims and test
  explicit, genuine page delivery before enabling Reader.
- Snapshot and fallback behavior must preserve successful sources when another
  fails; never treat an upstream error as a complete empty chapter inventory.
- Smoke physical tests need a signed, in-place update preserving the existing
  installation and repository configuration; not a Dev C or clean install.
