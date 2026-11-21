# MangaALL 0.5.5 / code10 — release review gate (NOT AUTHORIZED)

This directory deliberately has **no** `approved-artifact.json`. The working
Provider is **0.5.5-dev / code10**, `publication=development`. The signed
production Provider is still **0.5.4/code9 P-256 sequence 35**. The new
source is tested offline but **not signed, installed, approved or published**.

The publication workflow now selects a separate code10 pre-signature gate.
It rejects push/PR events, previous code9 authorization, missing/mismatched
SHA, changes to original signed code9 bytes, modified network capabilities,
changed signing root, unsigned or non-seq35 baseline, and unreviewed source.

## Release review procedure (not permission to execute it)

1. Finish integrated regression and editorial safety review for the _future_
   code10 source. Confirm source names/permissions, 3-source lookup, bounded
   pagination and source failures, Reader and version compatibility; assess
   MangaFire's external 403 separately. Do not claim canonical coverage.
2. In a **separate reviewed release PR**, change only
   `providers/mangaall/manifest.json` version name `0.5.5-dev` to `0.5.5`
   and publication flag `development` to `release`. Build
   `dist/providers/app.tsuzuki.mangaall-10.tsz` deterministically. Record its
   exact lower-case SHA-256 and review the complete .tsz payload.
3. In that **same reviewed release PR**, add
   `review/mangaall-code10/approved-artifact.json` with exactly:

   ```json
   {
     "reviewStatus": "approved",
     "versionCode": 10,
     "versionName": "0.5.5",
     "artifactSha256": "<64 lowercase hex characters after review>",
     "priorSequence": 35,
     "priorCode9Sha256": "d9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622"
   }
   ```

   The placeholder is intentionally **not** an approval. Review the SHA against
   a reproducible archive; never paste an expected hash from an unrelated
   prior build or mark a synthetic fixture as released.
4. **Only after explicit operator permission**, merge that reviewed release PR.
   Dispatch the existing `Publish repository` workflow on `main`, supplying
   `PUBLISH_MANGAALL_CODE10` and the independently reviewed exact SHA. The
   historical code9 token cannot authorize this release.
5. Verify the resulting P-256 signed index, strictly monotonic sequence,
   archived code9 immutability, new code10 archive hash, Host provenance,
   three-source Naruto/Death Note/Bleach integrated smoke, and all subsequent
   editorial/Reader checks. A GREEN CI alone is **not** release approval.

The code10 gate runs **before** the index planner/signer. A successful
`AUTHORIZED_CODE10_PREFLIGHT_ONLY_NOT_SIGNED` only validates preconditions;
the repository's actual sign/publish workflow remains a separate privileged
operation requiring its own credentials. No process in this README signs or
dispatches anything.
