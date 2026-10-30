# Tsuzuki Providers

Reference Provider repository for [Tsuzuki](https://github.com/jssantogit/tsuzuki).

This repository contains Tsuzuki-native SCRIPT Providers, repository publishing tooling, and conformance fixtures. Providers here are authored for the Tsuzuki Provider Platform directly; this is not a Keiyoushi/Mihon extension mirror or APK/Dex porting repository.

## Repository layout

```text
providers/                 Provider source trees
  mangafire/               First reference HTTPS reading Provider
  mangaall-dex/            MangaAll / MangaDex signed chapter-evidence adapter
  mangaall-ball/           MangaAll / MangaBall paused (not published)
  mangaall-dot/            MangaAll / MangaDot signed chapter-evidence adapter
mangaall/                  MangaAll product identity and aggregation contract
repository/                Signed-repository publication configuration
  config.json
tooling/                   Build, conformance, index, signing and verification tools
dist/                      Published .tsz artifacts and signed index
.github/workflows/         CI and manual publication workflows
docs/                      Authoring and repository notes
```

## MangaAll — signed metadata-only preview

**MangaAll is not MangaDex.** It is one multi-source product for real chapter evidence and,
eventually, reading in the Tsuzuki Reader. Its active source-isolated signed packages are:

- `app.tsuzuki.mangaall.mangadex`: MangaDex source, `reading.lookup@1` and `reading.chapters@1`.
- `app.tsuzuki.mangaall.mangadot`: MangaDot source, `reading.lookup@1` and `reading.chapters@1`.

Both use the existing signed repository identity and public key. They provide **chapter
observations to ICE, not independently verified editorial chapters**. `reading.pages@1`
is intentionally absent: real image delivery, scanlation attribution, provider access
terms and Android Reader smoke have not passed. Publishing the signed packages does not
certify Reader pages or complete canonical inventory.

MangaBall is paused pending upstream API authorization; its source and identity stay in
the repo but `publication=development` keeps it outside the signed index. The Host
MangaAll family installer requires [Host PR #167](https://github.com/jssantogit/tsuzuki/pull/167)
to be integrated; older Hosts may list two individual source adapters instead.

See [current release gates](docs/mangaall-active-sources-readiness.md),
[MangaAll product](mangaall/README.md), and
[provider issue #45](https://github.com/jssantogit/providers-tsuzuki/issues/45).

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
