# MangaALL 0.5.5/code10 — UNMERGED promotion proposal

**Prepared by explicit operator instruction to consolidate and stage promotion,
NOT by an instruction to approve, sign, or publish.**

This is a **draft release PR**. It intentionally stages the source manifest
`version=0.5.5/code10` and `publication=release` ONLY on the review branch.
The public `main` remains at `0.5.5-dev/code10` / `publication=development`
while the official signed P-256 sequence35 continues to identify
`0.5.4/code9`. **Do not merge this PR without new operator approval.**

## Exact already-inspected candidate

The source code was consolidated from development PR #91 and adversarial
review PR #97. The current unsigned source candidate was built at Provider
head `af5c1089c35c8f3d0bc56487b6a75c3dba6ddac0`, replayed from
the CI and source ZIP:
[Actions #44926001803](https://github.com/jssantogit/providers-tsuzuki/actions/runs/44926001803),
[review artifact](https://github.com/jssantogit/providers-tsuzuki/actions/runs/44926001803/artifacts/14715458775).

- Exact `app.tsuzuki.mangaall-10.tsz` **SHA-256**:
  `776d0e8bd64897c30283cad29f1aa331c86dac638deac1f106f042768167b94d`.
- Unsigned; never public; no P-256 signature; no Reader/canonical certification.
- The tracked `promotion-candidate-unapproved.json` is an **observation** of
  this SHA, **NOT** the separately required release approval lock.
- CI must rebuild the staged source package and match this SHA **byte for
  byte**, preserve the real seq35/code9 signed index and archive, and deny a
  nominally authorized `workflow_dispatch` while no approval lock exists.

## Protected transition — deferred pending explicit authorization

Before publication, a reviewer/operator must independently inspect the
exact final artifact and the source changes, including MangaDex chapter
work relation and language, MangaDot/MangaFire false-empty facet protection,
unified partial-terminal pagination and source failure handling. A source
change invalidates the candidate hash and must generate a fresh review.

After actual independent approval and **separate explicit authorization for
promotion/publication**, and only then:

1. Review the draft PR against the already-green development `main`.
2. Replace the unapproved review record with an independently reviewed,
   new file `review/mangaall-code10/approved-artifact.json`, containing the
   EXACT authorized SHA, `reviewStatus=approved`, 0.5.5/code10, signed seq35
   baseline and original code9 digest; do not fabricate this file from CI.
3. Re-run all CI and inspect GitHub source/head/permissions and trust root.
4. Merge this promotion PR to `main` only on explicit release approval;
   `Publish repository` must be separately dispatched with
   `mangaall_code10_authorization=PUBLISH_MANGAALL_CODE10` and the exact
   approved SHA. The historical code9 token cannot authorize code10.
5. Verify the new signed P-256 index sequence36, SHA of the distributed
   archive, code9 archived immutability, installed Host V1/V2 provenance,
   and then run true integrated Naruto, Death Note and Bleach live smokes
   with MangaDex+MangaDot+MangaFire in **one** provider.
6. After corrections, scale to 10–30 real works, then physical Galaxy A54.

A draft promotion PR with a green CI does NOT represent a final approval.
The source manifest in the draft branch is not production and cannot
become a signed release without the independent operator gate.
