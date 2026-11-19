# MangaAll code9 — first-release authorization preflight

Status: **guardrails under review; code9 remains unsigned, unpublished, and not installed**.

The official publisher uses the already pinned `app.tsuzuki.providers` root and
ECDSA P-256 index signature. The locally staged `0.5.4-dev-unsigned/code9`
is NOT a trusted artifact, and the synthetic Android runtime tests do not
attest source networks or real Reader/CDN pixels.

## New prevention before signing

`tooling/mangaall_code9_publication_gate.py` is invoked by the official
publisher after compiling packages, but **before** preparing a signed
sequence or accessing the signing key. For a new code9 release it requires:

- One previously signed MangaAll code8 entry, matching the archived code8 SHA-256.
- Unchanged repository identity and current signed index sequence.
- A reviewed real source tree (not the temporary staging copy), with
  explicit `publication=release`, version name `0.5.4`, code `9`,
  a V2 wrapper, and no `UNSIGNED_CANDIDATE_NOT_LIVE` marker.
- A byte-identical, deterministic rebuild of the code9 artifact from that
  source tree, rather than accepting an arbitrary ZIP with the correct ID.
- A **manual** `Publish repository` workflow dispatch with the exact
  `mangaall_code9_authorization=PUBLISH_MANGAALL_CODE9` input. A
  `publish.request` push cannot publish the first code9 even with a source
  manifest accidentally promoted. Code10+ requires a new reviewed gate.

The preflight prints `AUTHORIZED_PREFLIGHT_ONLY_NOT_SIGNED` when it passes:
this is **not a signature** or an approval of editorial identity, chapters,
or image delivery. Existing code8 publications and future unrelated Provider
publications are not forced to supply this code9-specific input. The normal
signed-index verifier and immutable-package planner remain required.

## Remaining release requirements

Do not set `publication=release` or dispatch code9 yet. The staged provider
still emits `UNSIGNED_CANDIDATE_NOT_LIVE`, and the Host's V2 decoder accepts
only that synthetic-development provenance today. Before a real release,
review the V2 production provenance with a signed-package-derived identity
assertion on the Host (not a self-declared JS string), install authorization,
threat model, permission/network policy, and actual signed index outcome.
Require independent editorial corroboration and preserve the partial-evidence
fail-closed boundary. Finally validate live three-source lookup and actual
Reader/CDN pixels on an authorized Android network without bypassing 403.

Run the adversarial release-gate tests offline:

```sh
python3 -m unittest discover -s tooling -p 'test_mangaall_code9_publication_gate.py' -v
```

Tracks [Provider #72](https://github.com/jssantogit/providers-tsuzuki/issues/72)
and [Host #207](https://github.com/jssantogit/tsuzuki/issues/207).
