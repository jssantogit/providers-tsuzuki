# MangaAll 0.5.2 / code7 — controlled release readiness

Status: **PREPARED, NOT APPROVED FOR PUBLICATION** (2026-11-13). This is
a release plan and a read-only CI audit, not a signed code7 release or a
physical-device fix.

## Immutable facts

| Contract | Audited value |
| --- | --- |
| Official signed repository | `app.tsuzuki.providers` |
| Official signing key ID | `tsuzuki-provider-root-2026-02` |
| Official P-256 SPKI SHA-256 fingerprint | `20875348d95649ff0009e329f0d43de1b84ccf8af7966c215d5e0f449e697159` |
| Official signed baseline | sequence **32**, `main@3e0b0bc813910929c2215ad26bc46ff5a6a73706` |
| Already published MangaAll | `app.tsuzuki.mangaall` **0.5.1/code6**, SHA-256 `aa9c101e0764019bc0d09774aeea1600e6bb9f02e12e9c9096f37d0549720320` |
| Candidate package | **0.5.2/code7**, SHA-256 `cbc7e890fda26138a20358a332c8a700b3aec19ba14c47c53834dc35001673f0` |
| Exact next publication **if explicitly authorized** | **sequence 33**, exactly one changed descriptor, no signing-key rotation, no repository ID change |

The code7 distributable bytes were built by `tooling/build_provider.py` from
the actual MangaAll Provider source, with its `publication` source-only
control stripped from the runtime manifest. The Android Host/Reader acceptance
tests pin the same SHA and execute the original isolated JS modules.

## Machine-enforced pre-publication audit

The new read-only workflow [MangaAll 0.5.2 signed-release dry run
(no signing)](../.github/workflows/mangaall-release-preflight.yml) runs on
the code7 calibration Draft branch. It checks out the current official
`main` into a separate **read-only input**, and refuses to proceed if its
commit is no longer the known sequence-32 baseline.

It then:

1. Verifies the original P-256 signed index against the committed public key;
   verifies its envelope/payload bytes, repository identity, trust fingerprint,
   original code6 archive and one-link enrollment.
2. Ensures the candidate has the **same** published provider ID, base
   permissions, source origins, Reader/browser grants, Host API, languages and
   capabilities; only the code6 → code7 version fields may change.
3. Rebuilds `app.tsuzuki.mangaall-7.tsz` and checks the **exact** SHA from
   the previously green Android run.
4. Makes a **temporary copy** of the official repository and runs its actual
   `prepare_publication.py` and `build_index.mjs` programs there, with
   only the candidate's unified MangaAll source and archive overlaid.
5. Requires precisely sequence **32 → 33** and a single changed descriptor.
   Every other published Provider, revocation, URL, trust-root value and the
   old rollback archive must remain unchanged.
6. Confirms the existing signed index is not overwritten. It never loads the
   private signing secret, signs the candidate, commits generated output or
   pushes anything to `main`.

[Provider CI #43453252680](https://github.com/jssantogit/providers-tsuzuki/actions/runs/43453252680):
**PASS**, including 14 deliberate mutation tests (ID duplication, extra
adapter, broadened permissions, other Provider changes, SHA mismatch, root
rotation, revoked artifacts, wrong sequence, and downgrade) and the real
public-publisher dry run. Normal Provider CI for this branch is also green.

[Host Android #43426396395](https://github.com/jssantogit/tsuzuki/actions/runs/43426396395)
previously passed **9/9**: actual published code6 signature + installation,
simulated same-key code6 → code7 verification and rollback, SQLite canonical
chapters/library/preferred binding/progress continuity, and original code7
`.tsz` → ReaderActivity tap → synthetic HTTP 503/retry → decoded image pixels.
That simulated code7 index was signed with an ephemeral **test** root, **not**
the official private key. Real MangaFire, its anti-bot browser challenge,
remote CDN bytes, official code7 update and physical Galaxy A54 preservation
remain unverified.

## Human-authorized production sequence (not executed)

**Do not merge or publish automatically.** After an explicit release decision:

1. Review/merge Host Draft [#196](https://github.com/jssantogit/tsuzuki/pull/196)
   followed by [#197](https://github.com/jssantogit/tsuzuki/pull/197),
   confirm final Format/CI and a compatible Host APK. Preserve app data.
2. Review/merge Provider Draft
   [#63](https://github.com/jssantogit/providers-tsuzuki/pull/63)
   followed by [#64](https://github.com/jssantogit/providers-tsuzuki/pull/64).
   Re-run the release preflight if the official repo baseline has moved.
   The unified provider remains `app.tsuzuki.mangaall`; no second feed or key.
3. Only with explicit authorization, invoke the existing official
   **Publish repository** workflow on `main`. Its existing-key ECDSA
   signature and SHA validations must succeed. Expect the signed descriptor
   code7 and sequence 33 **only if sequence 32 is still current**.
4. On the Galaxy A54, update the Host **in place**, refresh the already
   enrolled official repository, and update MangaAll **6 → 7** in Installed.
   Do not remove app data, re-enroll the same key or install an alternate ID.
5. Check Punpun `mangafire:zk12` and Koe no Katachi `mangafire:7p56`:
   full canonical chapter count and numbering, saved preferred edition not
   silently rebound, correct candidate languages/authors and source list,
   actual Reader opening/CDN image pixels, retry after failure, and reading
   position after app restart. Capture bounded structured logs if any fails.
6. If update or reading fails, keep the official signed index monotonic.
   Use the Host's Provider rollback to retained code6, then diagnose the
   typed failure before planning another release. Never republish altered
   bytes under code7 or downgrade a signed sequence.

**Release decision remains separate from CI readiness.** Green offline
checks are useful gates, not a claim that the upstream MangaFire environment
or user-visible issues are physically resolved.
