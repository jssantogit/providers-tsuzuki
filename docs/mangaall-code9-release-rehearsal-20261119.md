# MangaAll 0.5.4/code9 — isolated promotion and index planning rehearsal

Date: 2026-11-19. **OFFLINE ONLY · NEVER SIGNED · NEVER PUBLISHED · NOT HOST INSTALLED**.

## What this tests

`tooling/mangaall_code9_release_rehearsal.py` verifies the **real existing**
sequence-34 index signature using the official read-only
`tooling/verify_index.mjs` and verifies every already signed package digest.
That proves the **code8 baseline** under the configured public key, NOT a
code9 signature or Host installation.

It then creates a disposable **outside-the-repository** working root, copies
the current Provider sources, existing published archives, repository config
and the previously reviewed three-file code9 overlay, **without copying any
signed index into the working root**.

Only in that disposable copy, it:

1. Reconstructs `0.5.4/code9` from the immutable code8 archive and reviewed
   `review/mangaall-code9` overlay (PR #77).
2. Replaces the copied `providers/mangaall` with that exact reviewed
   three-source tree and changes **only the sandbox** source control field
   `publication=development` to `publication=release`.
3. Builds a deterministic code9 archive and requires its bytes to match the
   reviewed code9 bytes exactly.
4. Verifies a push and a dispatch **without** authorization are rejected by
   the real publication preflight. To test only the preflight's positive
   branch, it supplies a **synthetic** dispatch event and literal authorization
   string to the function **in the disposable copy**. No Actions dispatch,
   private key, signer, webhook or write to the actual repository occurs.
5. Runs the actual publication planner and unsigned index-payload builder
   **only against that throwaway directory**; asserts the would-be sequence
   is **35** and the sole changed provider is unified MangaAll 0.5.4/code9.
   The original signed code8 archive stays identical; the unsigned draft index
   cannot masquerade as a new signed `dist/index.json`.
6. Deletes the entire temporary tree and tests all protected official
   source/index/config/publisher-workflow hashes remain identical.

This is a **planning simulation**, not an operator's publication approval.
The official publisher is not called, and no `sign_index.mjs` is invoked.
Even a passing simulated authorization is never permission to publish.

## Entry point & challenge coverage

`tooling/test_mangaall_code9_review_entrypoint_http.mjs` executes the
**materialized code9 main.js** against synthetic HTTP. A normal V1 call
retains the V1 `items` shape; a V2 call concurrently reaches MangaDex,
MangaDot and MangaFire **within one unified MangaAll lookup** and emits
`V2_READONLY_OBSERVATION` without signing claims, binding or Reader grants.

Another V2 call forces MangaDot to return HTTP 403 while MangaDex and
MangaFire return synthetically healthy data; the result attributes
`CHALLENGE_BLOCKED/403` only to MangaDot and permits precisely one
source-specific retry before ending incomplete. No cookies, browser
bypass, response bodies or real website access are involved.

Run both offline suites:

```sh
python3 -m unittest discover -s tooling -p 'test_mangaall_code9_review_source.py' -v
python3 -m unittest discover -s tooling -p 'test_mangaall_code9_release_rehearsal.py' -v
```

## Remaining safety/approval blockers

- Review *actual* code9 bytes and relevant host/Provider security policy, plus
  independent editorial identity evidence.
- Prepare and review separately a real `providers/mangaall` source promotion
  to `0.5.4/code9`, `publication=release`. Do **not** include it in this
  rehearsal PR; it is a separate production change with independent approval.
- Under an explicitly authorized manual `PUBLISH_MANGAALL_CODE9` release,
  verify that the newly signed **sequence 35** index truly binds the code9
  artifact SHA under the original pinned P-256 root. No such signature exists.
- Install the authentic signed-index-bound code9 package in an isolated Host
  Android environment, validate installed SHA, repository/root and live
  read-only V2 diagnostics. This is distinct from the current QuickJS mock
  provenance tests.
- Finally confirm editorial matching, eligible source options in one Reader
  session and actual authorized CDN pixels; never classify HTTP403 as a
  successful, empty or completed source.

**After this PR, public code8 0.5.3/index sequence 34 remain untouched**.
Relevant [Host #207](https://github.com/jssantogit/tsuzuki/issues/207)
and [Provider #72](https://github.com/jssantogit/providers-tsuzuki/issues/72).
