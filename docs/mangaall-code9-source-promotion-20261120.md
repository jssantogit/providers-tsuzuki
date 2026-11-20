# MangaAll 0.5.4/code9 — reviewed source promotion (not a publication)

Status 2026-11-20: **SOURCE TREE PROMOTED; SIGNED INDEX STILL code8/sequence 34**.

## Exact scope

The `providers/mangaall` source tree now includes only the three changes
reviewed in [Provider PR #77](https://github.com/jssantogit/providers-tsuzuki/pull/77)
relative to the archived, SHA-256-attested code8:

1. `manifest.json`: version `0.5.4/code9`, same capabilities, host API,
   network/browser origins, storage policy and source languages as code8,
   with **`publication=release`** in the source repository only.
2. `main.js`: one `createMangaAllLookupV2Candidate` reading object
   wrapping the original `createMangaAllReading` router, all three adapters
   (MangaDex, MangaDot and MangaFire), and all V1 chapters/pages APIs.
3. `modules/v2-candidate.js`: neutral `V2_READONLY_OBSERVATION` contract
   with typed per-source statuses and a 48 KiB UTF-8 output envelope bound;
   no automatic editorial binding, reader authority or legacy V1 `items`.

The **official index is NOT updated by this source-only PR**: the root
`tsuzuki-provider-root-2026-02`, index sequence 34 and archived
`app.tsuzuki.mangaall-8.tsz` remain immutable. The source manifest is not
an installed package and cannot authenticate its own JS bytes.

## Publication guard

The source flag `publication=release` enables **manual-only** reviewed
publication. It does **not** cause a publication simply by merging source.
The official `.github/workflows/publish.yml` is triggered only by explicit
`workflow_dispatch` or a change to `repository/publish.request`. The
code9 pre-signature gate REJECTS push triggers and all dispatch calls without
the literal `PUBLISH_MANGAALL_CODE9` approval input. This PR DOES NOT
edit `repository/publish.request`, dispatch a workflow or access a signer.

Even with authorization, the preflight rebuilds and requires **identical
code9 archive bytes** to the reviewed overlay constructed from the published
code8 ZIP. Any unexpected JS, adapter or permission differences cause
the release to fail before the signing step.

During ordinary CI, calling this gate with event `push` and no approval
**must be rejected** and reported as `DENIED_NON_MANUAL_CI`; that
expected denial is a passing release-safety assertion. The CI's normal
publication dry run may plan **sequence 35 in the ephemeral CI checkout**
without a signature. Do not mistake that for production index sequence 35.

All old V2 staging tests now derive their legacy source bytes from the
**actual archived code8**, not the now-code9 working source tree, so the
existing immutable code8 package remains regression tested. The unsigned
`0.5.4-dev-unsigned` and `0.5.4-preview-unsigned` fixtures remain
test-only, independent and not eligible for signed installation.

## Acceptance still required outside this PR

- Publication operator must separately approve a manual code9 release.
- A new **real** signed P-256 index must bind the exact code9 SHA-256
  and verifiably advance to sequence 35; no such signed index exists yet.
- Host real stored-artifact installation must check the new signed index,
  root pin, SHA, version and V2 provenance against the installed code9 bytes,
  without synthetic fixture authority.
- Independent editorial identity and real Android three-source/Reader/CDN
  validation must follow; HTTP 403 and unknown-source conditions remain
  incomplete and cannot authorize canonical edits or Reader access.

References: [Provider #72](https://github.com/jssantogit/providers-tsuzuki/issues/72),
[Host #207](https://github.com/jssantogit/tsuzuki/issues/207),
[Host PR #223](https://github.com/jssantogit/tsuzuki/pull/223).
