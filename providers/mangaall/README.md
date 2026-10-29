# MangaAll — Phase 1 (internal, unpublished)

MangaAll is the planned unified HTTPS source experience for Tsuzuki; GitHub issue #45.
Its own SCRIPT identity is app.tsuzuki.mangaall. It does not replace or mutate the
already installed app.tsuzuki.mangafire Provider.

## Planned source matrix

| Source | Status | Network enabled |
| --- | --- | --- |
| Manga Livre.to | planned | no |
| MangaDex | experimental evidence-only | yes (in this unpublished branch only) |
| MangaFire | planned, existing provider maintained separately | no |
| MangaBall | planned | no |
| MangaDotNet (MangaDot) | planned | no |
| AnimeXNovel | planned | no |
| MangaFlix | planned | no |

MANGA Plus is an additional candidate, **not** one of the seven required sources.

## Current contract

- reading.lookup@1: MangaDex title search, aliases, stable mangadex:UUID work keys.
- reading.chapters@1: per-language en/pt-br, bounded paged chapter evidence,
  stable mangadex:UUID chapter keys, numeric chapter labels only.
- reading.pages is **not supported**; this provider is not a Reader source.
- All sources except MangaDex are disabled and have no network grants. The manifest
  permits only https://api.mangadex.org; no browser, storage or secret access.
- 403/429, broken JSON or pagination errors abort the invocation, rather than
  publishing a misleading complete-but-empty snapshot.
- Chapter observations remain PROVIDER_PROVISIONAL under ICE #155.

## Host architectural blocker

In Tsuzuki Host V1, CollectProviderReadingEvidence discovers one exact work binding
per provider ID + facet. Publishing two successful matches for the same work
from two upstream websites in one MangaAll identity would be ambiguous, and Host
would refuse to bind. Therefore this phase deliberately activates one source
only. **Do not enable other sources** by flipping registry flags: first design
source-qualified bindings/facets and independent permissions and retry state
without breaking existing stored bindings or the ICE source identity model.
This phase is groundwork, not multi-source support in the shipping app.

## Publication hold

MangaDex documents restrictions: credit MangaDex; credit scanlation groups and
honor removal requests when providing reader access; do not monetize API-backed
apps with ads or paid services. Before publishing this experimental package:
confirm Tsuzuki's intended distribution/compliance and provide durable source
attribution in its UI. The lack of reading.pages is intentional and does not
automatically waive API attribution.

Do not add this package to dist, repository/config.json, or the signed index
until those checks, Host compatibility, CI and Android acceptance pass.

## Development

Run node tooling/test_mangaall.mjs and python3 tooling/check_repository.py.
All HTTP tests use fixtures, not the upstream service.
