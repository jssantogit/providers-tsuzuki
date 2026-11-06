# Stable MangaAll preview channel (not production)

This replaces disposable `smoke.v1`–`v4` repositories. The installed Provider
remains **`app.tsuzuki.mangaall`**, even when its code/name rises from
`0.4.0/code4` to `1.0.0/code5`, then `1.2.0/code6`. Source platforms
(MangaDex, MangaFire, MangaDot) are internal to that single package.

## One-time owner-only setup (not yet provisioned)

1. Generate an ECDSA P-256 private key on a secure machine, for example:
   `openssl ecparam -name prime256v1 -genkey -noout -out mangaall-preview-private.pem`.
   Convert to PKCS#8 PEM if your local OpenSSL variant requires it.
2. Back it up securely *outside the repository*; do not send it to chat, Notion,
   logs, CI artifacts or the source tree. Store it in the GitHub Actions repository
   secret **`TSUZUKI_MANGAALL_PREVIEW_SIGNING_KEY_PEM`**.
3. Create or update the long-lived branch **`tsuzuki/mangaall-preview`**
   from reviewed provider source and workflow. Configure branch protection so
   unreviewed pushes cannot execute the signing workflow with the secret.
4. Publish initially by updating `repository/preview-publish.request` on that
   branch. The workflow creates `dist/preview/enrollment.json`, a verified
   `dist/preview/index.json`, and the immutable versioned `.tsz`.
   Later version upgrades repeat the same workflow with a higher
   `providers/mangaall/manifest.json:version.code`; **do not regenerate the key**.

The stable one-link enrollment URL will be:

`https://raw.githubusercontent.com/jssantogit/providers-tsuzuki/tsuzuki/mangaall-preview/dist/preview/enrollment.json`

Its repository ID is always `app.tsuzuki.mangaall.preview`; version name/code
belong to the **Provider artifact**, not the repository. The signer remains
dedicated to the preview channel and unrelated to the production
`TSUZUKI_PROVIDER_SIGNING_KEY_PEM`. If a key must be rotated, use the
Host's signed key-rotation mechanism, not a new smoke repository.

**Not active until owner securely configures the secret and publishes the first
signed preview snapshot.** No default key, fallback signing or unsigned index.

## Gate to production

The official signed repository uses `app.tsuzuki.providers` and retains its
separate existing P-256 signing root. Promoting MangaAll to a stable public
release requires completed CI, Android Reader physical smoke, provider
attribution and removal-policy acceptance, then `publication` promotion
under its existing `app.tsuzuki.mangaall` identity.

A user's initial move from the old ephemeral smoke root or the preview channel
to the official repository is **one explicit trust-origin migration**; after
that, further public MangaAll versions update in place. Do not weaken origin
pinning or silently delete installed Providers.
