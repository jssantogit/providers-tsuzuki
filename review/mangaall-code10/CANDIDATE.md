# MangaALL 0.5.5/code10 — package prepared for independent review

**Status:** CANDIDATE ONLY. This PR intentionally does not change
`providers/mangaall/manifest.json` from `0.5.5-dev` to `0.5.5`, and does
not create `approved-artifact.json`. The signed production archive remains
`0.5.4/code9` under repository P-256 sequence 35.

## Reviewable output

The `MangaALL code10 release candidate review (unsigned)` pull-request
workflow builds a reproducible **0.5.5/code10 runtime .tsz** from a disposable
copy of the current code10 source. Its uploaded GitHub Actions artifact
contains:

- `app.tsuzuki.mangaall-10.tsz`: the complete **unsigned** ZIP with final
  runtime version 0.5.5/code10 (source flag `publication` stripped).
- `candidate-review.json`: exact SHA-256, source head commit and pinned
  P-256 seq35/code9 baseline; status `candidate_unapproved`.

The workflow only has `contents: read`, uses no signing secrets and cannot
modify the public index or dispatch publication. It verifies the original
signed index, exact old archive SHA, deterministic rebuild and unchanged
network/browser grants, Host capabilities, entrypoint and languages.

## Required independent review before final approval

- Verify the ZIP's SHA-256 and the exact source commit. The workflow may be
  rerun, but **a different SHA requires a fresh independent review**.
- Review MangaDex evidence pagination (2x12), correct work/language/numeric
  hosted chapter only and the `UNKNOWN` state when evidence is incomplete.
- Review unified MangaDex + MangaDot + MangaFire lookup; bounded retry, failed
  source's terminal error cursor, 48KiB continuation, cursor facet isolation,
  competing editions, false binding prevention, and no MangaFire challenge
  bypass. Review V2 isolated read-only diagnostics separately.
- Confirm the production Host version's V1 behavior and `ICE` editorial
  DENY-ALL policy; approval of package identity is not chapter certification.
- Confirm no unexpected source file, permissions, signing root, Provider ID or
  unrelated package changes.

Once **separately authorized to publish**, create a distinct reviewed
promotion PR that changes the source manifest to `0.5.5/release`, places the
exact reviewed `approved-artifact.json` in the repository, and verifies that
the publication workflow builds the **same** ZIP digest. The final operator
must then explicitly dispatch the workflow on `main` with the code10 token
and matching SHA-256. Do **not** treat this candidate PR or its GREEN CI as
authorization to merge/publish.

After a genuine signed release, run the combined Naruto / Death Note / Bleach
source-to-Kotlin/SQLite/Reader smoke, fix real issues, escalate to 10–30
works, and only then validate on physical Galaxy A54.
