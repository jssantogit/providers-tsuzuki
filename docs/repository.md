# Repository trust and publication

Tsuzuki does not treat a repository URL as sufficient trust. Enrollment pins a P-256 public key and a stable repository identity before any Provider artifact can be installed.

## Stable identity

The reference repository uses:

- repository ID: `app.tsuzuki.providers`
- key ID: `tsuzuki-provider-root-2026-02`
- signed index: `https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/main/dist/index.json`

The public-key Base64 value and SHA-256 fingerprint are generated from `repository/public-key.pem`.

## Enroll this repository in Tsuzuki

In **Settings → Providers → Repositories → Add repository**, enter exactly:

- Repository name: `Tsuzuki Providers`
- Repository ID: `app.tsuzuki.providers`
- Signed index URL: `https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/main/dist/index.json`
- Signing key ID: `tsuzuki-provider-root-2026-02`
- P-256 public key (Base64): `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEbMgJgxuSDFzFOgh+kTtDlUAgVwh4dtXEz4J5rn2udb1fdw7eKDHrkJBXP3l13k35/42i8NBs7pCGSCO3o75nnw==`

Tsuzuki should display this SHA-256 fingerprint before trust is confirmed:

`20875348d95649ff0009e329f0d43de1b84ccf8af7966c215d5e0f449e697159`

Confirm trust only if the displayed fingerprint matches exactly. The verified signed repository **sequence `20`** contains the existing Direct P2P, MangaFire and Nyaa packages, plus **MangaAll / MangaDex** and **MangaAll / MangaDot** version `0.1.0` / code `1`. MangaBall remains paused and is **not** in the signed index. MangaAll adapters expose only `reading.lookup@1` and `reading.chapters@1`, **not** Reader pages.

**Already enrolled with this same key?** Refresh the existing repository in the app, preserving existing installed Providers, grants and library. The two MangaAll source adapters appear in **Discover**. In Host versions that contain the MangaAll family grouping (PR #167), the app can install both as one MangaAll set; older Hosts may list the two adapters separately. No app reinstall, data reset, repository re-enrollment or key rotation is needed for this publication.

## Bootstrap-key replacement in October 2026

`tsuzuki-provider-root-2026-02` replaces the previous bootstrap root `tsuzuki-provider-root-2026-01`.

This was a historical bootstrap replacement, not an in-band continuity-preserving rotation. Existing installations pinned to the old root must not be silently repinned. **Do not reset working app data or delete existing provider enrollments to consume sequence 20.** If a device remains pinned to the obsolete root, investigate its trust state and use the supported trust-rotation/recovery workflow separately; it is not equivalent to refreshing the current enrolled repository.

For a deployed ecosystem where preserving existing enrollments matters, future signing-key rotation must be introduced through the repository trust-rotation protocol from a previously trusted signed index rather than replacing the bootstrap root in place.

## Bootstrap key

Generate a repository root with:

```bash
node tooling/generate_keypair.mjs
```

This creates:

- `repository/public-key.pem` — commit this;
- `.keys/repository-private.pem` — never commit this.

Copy the complete private PEM into the GitHub Actions secret `TSUZUKI_PROVIDER_SIGNING_KEY_PEM`, then store the private key in a secure user-controlled backup. The repository secret is the normal publisher copy; the backup is for recovery/rotation only.

Tsuzuki computes the enrollment fingerprint from the X.509/SPKI DER bytes represented by the public key, matching the app's `providerRepositoryKeyFingerprint()` implementation.

## Publication

1. Change Provider source and increment the Provider `version.code` for a release.
2. Increment `sequence` in `repository/config.json` for every new signed index payload.
3. Merge normal source/CI changes to `main`.
4. Run the manual `Publish repository` workflow or update `repository/publish.request` deliberately.
5. The workflow builds deterministic `.tsz` files, creates the exact index payload, signs it with ECDSA P-256/SHA-256, verifies the result against the committed public key, and commits only the generated `dist/` output.

A signing secret that does not correspond to `repository/public-key.pem` fails verification and must never produce a published index.
