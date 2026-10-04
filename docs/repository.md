# Repository trust and publication

Tsuzuki does not treat a repository URL as sufficient trust. Enrollment pins a P-256 public key and a stable repository identity before any Provider artifact can be installed.

## Stable identity

The reference repository uses:

- repository ID: `app.tsuzuki.providers`
- key ID: `tsuzuki-provider-root-2026-01`
- signed index: `https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/main/dist/index.json`

The public-key Base64 value and SHA-256 fingerprint are generated from `repository/public-key.pem` once the bootstrap signing key is created.

## Bootstrap key

Generate the repository root once:

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
4. Run the manual `Publish repository` workflow.
5. The workflow builds deterministic `.tsz` files, creates the exact index payload, signs it with ECDSA P-256/SHA-256, verifies the result against the pinned public key, and commits only the generated `dist/` output.

Never replace the root key silently. Key rotation must be introduced through a previously trusted signed index and should be implemented deliberately when needed.
