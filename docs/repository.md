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

Confirm trust only if the displayed fingerprint matches exactly. Repository sequence `3` contains `app.tsuzuki.mangafire` version `0.1.2` / code `3` once the corresponding publication workflow has completed successfully.

After enrollment, refresh the repository, open **Discover**, install MangaFire, then open its Provider detail and enable the Provider/facet needed for the smoke test.

## Bootstrap-key replacement in October 2026

`tsuzuki-provider-root-2026-02` replaces the previous bootstrap root `tsuzuki-provider-root-2026-01`.

This is an explicit bootstrap replacement for the current pre-release acceptance cycle, not an in-band continuity-preserving rotation. Existing installations pinned to the old root must not be silently repinned. For acceptance testing, clear the app's Provider trust/install state (a clean app-data reset is acceptable), enroll the repository again with the new key and fingerprint above, then reinstall the Provider.

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
