# Tsuzuki Providers

Reference Provider repository for [Tsuzuki](https://github.com/jssantogit/tsuzuki).

This repository contains Tsuzuki-native SCRIPT Providers, repository publishing tooling, and conformance fixtures. Providers here are authored for the Tsuzuki Provider Platform directly; this is not a Keiyoushi/Mihon extension mirror or APK/Dex porting repository.

## Repository layout

```text
providers/                 Provider source trees
  mangafire/               First reference HTTPS reading Provider
repository/                Signed-repository publication configuration
  config.json
tooling/                   Build, conformance, index, signing and verification tools
dist/                      Published .tsz artifacts and signed index
.github/workflows/         CI and manual publication workflows
docs/                      Authoring and repository notes
```

## First Provider: MangaFire

`app.tsuzuki.mangafire` is the first reference Provider. V1 intentionally starts with the smallest useful vertical slice:

- `reading.lookup@1`
- `reading.chapters@1`
- `reading.pages@1`
- English content facet
- host-mediated HTTP only, with the bounded Browser Host Service as a fallback when MangaFire returns a challenge response

The Provider does not receive Android APIs, raw sockets, filesystem access, JNI, or arbitrary native/JVM execution.

## Local checks

No third-party package manager dependencies are required.

```bash
node tooling/test_mangafire.mjs
python3 tooling/check_repository.py
```

Build the Provider artifact:

```bash
python3 tooling/build_provider.py providers/mangafire dist/providers/app.tsuzuki.mangafire-1.tsz
```

## Publishing

Tsuzuki repository indexes use ECDSA P-256/SHA-256. The private signing key is never committed.

`repository/config.json` defines the stable repository ID, signing-key ID, monotonic sequence and public artifact base URL. `tooling/build_index.mjs` creates the exact payload bytes and `tooling/sign_index.mjs` wraps them in the envelope consumed by Tsuzuki.

The `Publish repository` workflow is deliberately manual and requires the repository secret `TSUZUKI_PROVIDER_SIGNING_KEY_PEM`.

See [`docs/repository.md`](docs/repository.md) for the trust/bootstrap flow.
