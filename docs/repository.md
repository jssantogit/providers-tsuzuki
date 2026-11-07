# Repository trust and publication

Tsuzuki does not treat a repository URL as sufficient trust. Enrollment pins a P-256 public key and a stable repository identity before any Provider artifact can be installed.

## Stable identity

The reference repository uses:

- repository ID: `app.tsuzuki.providers`
- key ID: `tsuzuki-provider-root-2026-02`
- signed index: `https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/main/dist/index.json`

The public-key Base64 value and SHA-256 fingerprint are generated from `repository/public-key.pem`.

## One-link enrollment (new Host)

Once the updated Tsuzuki Host has passed its release gates, open
**Settings → Providers → Repositories → Add repository**, paste only:

`https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/main/dist/enrollment.json`

Tap **Verify repository**, inspect the resolved name, repository ID, signed-index
URL and the P-256 SHA-256 fingerprint, and explicitly approve trust. The document
contains **only public** bootstrap material. It is not signed by itself; the
Host separately verifies the index signature against the displayed public key
*before* allowing enrollment, and pins this trust root thereafter.

### Normal updates — no reinstall/re-enrollment

This repository's stable identity is `app.tsuzuki.providers` and its signing
root is `tsuzuki-provider-root-2026-02`. Publish each MangaAll release as
the **same** `app.tsuzuki.mangaall` Provider with a strictly higher
`version.code`. `version.name` is the user-visible release (for example
`1.0.0` → `1.2.0`). The signed index increments its repository sequence;
the Host recognizes `UPDATE_AVAILABLE`, verifies SHA-256 and the signature,
then updates in place with rollback. The old signed package stays immutable.
**Never** create `...smoke.v5`, `...smoke.v6` as the standard update mechanism.

The v1–v4 one-off physical smoke feeds used distinct ephemeral keys and
repository IDs; they are **not** an upgradable release channel. Migrating a
device installed from one of these feeds to this stable repository requires
a **single explicit origin change** after the stable MangaAll release has
passed acceptance, never a silent repin.

MangaAll uses the **existing** signed repository, not a second preview
repository, new signing key or a different publisher. Versions remain opt-in
installations from that same signed index. `publication=development` continues
to exclude the experimental package until physical smoke and release gates pass.

### First-time migration from an old smoke installation

The disposable smoke feeds used a different trust origin. When the unified
MangaAll release is approved and present in the official signed index:

1. Update the Tsuzuki Host in place. Never remove the Host or its data.
2. Uninstall **only** the old `app.tsuzuki.mangaall` from the smoke origin
   using Providers → Instalados → Desinstalar.
3. Remove only its old `app.tsuzuki.mangaall.smoke.vN` enrollment if present.
4. Refresh the **existing** `app.tsuzuki.providers` repository. Do **not**
   add it again if already enrolled with its pinned key.
5. Install the single `app.tsuzuki.mangaall`. From then on, every increase
   in `version.code` appears as **Atualizar**, preserving trust and rollback.

The official signed index still includes the older `mangaall.mangadex` and
`mangaall.mangadot` source-adapter packages for compatibility and package
immutability. A new Host hides their **Discover** cards only when the
unified MangaAll is eligible in that same repository; installed older packages
remain visible for deliberate user removal. Never silently uninstall them.

### MangaAll promotion gate

Before publishing the first unified package, confirm the updated Host and
provider CI/Android gates, real chapter mapping, correct editorial candidate
identity, language/source choices, image delivery, attribution and physical
Reader smoke. Only then promote the manifest from `development`, increase
`version.code` as needed and explicitly run the existing official publisher.
This is a deliberate signed-index addition, **not** a new repository.

## Manual enrollment for older Hosts

Only older Hosts without the single-link form need the five manual fields. Use:

- Repository name: `Tsuzuki Providers`
- Repository ID: `app.tsuzuki.providers`
- Signed index URL: `https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/main/dist/index.json`
- Signing key ID: `tsuzuki-provider-root-2026-02`
- P-256 public key (Base64): `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEbMgJgxuSDFzFOgh+kTtDlUAgVwh4dtXEz4J5rn2udb1fdw7eKDHrkJBXP3l13k35/42i8NBs7pCGSCO3o75nnw==`

Tsuzuki should display this SHA-256 fingerprint before trust is confirmed:

`20875348d95649ff0009e329f0d43de1b84ccf8af7966c215d5e0f449e697159`

Confirm trust only if the displayed fingerprint matches exactly. The official
signed index contains existing Direct P2P, MangaFire and Nyaa packages and
legacy MangaAll / MangaDex and MangaAll / MangaDot adapters. Those adapters
are **not** the single, multi-source MangaAll package. MangaBall remains
paused. The unified MangaAll is currently development-only and **absent**
from the official index.

**Already enrolled with this same key?** Refresh the repository rather than
re-enrolling or resetting app data. No reinstall or key rotation is needed
for a normal update of a Provider from this repository.

**Historical note:** publication sequence 21 fixed malformed package manifests
by excluding repository-only `publication` metadata from Host V1 archives.
Do not confuse that legacy migration with the new unified MangaAll release.

## Bootstrap-key replacement in October 2026

`tsuzuki-provider-root-2026-02` replaces the previous bootstrap root `tsuzuki-provider-root-2026-01`.

This was a historical bootstrap replacement, not an in-band continuity-preserving rotation. Existing installations pinned to the old root must not be silently repinned. **Do not reset working app data or delete existing provider enrollments to consume sequence 21.** If a device remains pinned to the obsolete root, investigate its trust state and use the supported trust-rotation/recovery workflow separately; it is not equivalent to refreshing the current enrolled repository.

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
