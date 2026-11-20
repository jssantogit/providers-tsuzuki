# MangaAll 0.5.4/code9 — first real three-source V2 lookup under P-256 signed index

**20 Nov 2026.** This is a **source-level, direct HTTP runner** report; it does
not represent a production Android session, canonical editorial decision,
signed *installation* on the runner, chapter availability or actual Reader CDN
pixels.

Evidence: [Provider run #44741273417](https://github.com/jssantogit/providers-tsuzuki/actions/runs/44741273417),
[PR #84](https://github.com/jssantogit/providers-tsuzuki/pull/84).
The test first ran the real `verify_index.mjs` on the **official P-256
signed sequence 35** with a unique MangaAll **0.5.4/code9** entry, pinned
SHA-256 `d9c223146faa9fea0e5b1593711b74836bc0af3c2939b2c6f246dbb2e4646622`,
then required the tested JS package bytes to match the published .tsz and
the reviewed code9 overlay.

The test probed *Naruto*, *Death Note* and *Bleach* in sequence. Each work
used **one** unified MangaAll V2 lookup with the MangaDex, MangaDot and
MangaFire adapters operating inside that single call; not three separately
configured Providers. The source observation artifact
`mangaall-code9-v2-direct-live-source-status` (artifact ID `14631935590`)
contains **only sanitized status/counts** and has short retention.

| Work | MangaDex page 1 | MangaDot page 1 | MangaFire page 1 | Result |
| --- | --- | --- | --- | --- |
| Naruto | 2 candidates, SUCCESS_PAGE, not exhausted | 3 candidates, SUCCESS_PAGE, not exhausted | CHALLENGE_BLOCKED, HTTP 403 | PARTIAL_EVIDENCE |
| Death Note | 3 candidates, SUCCESS_PAGE, exhausted | INVALID_RESPONSE, not retryable | CHALLENGE_BLOCKED, HTTP 403 | PARTIAL_EVIDENCE |
| Bleach | 4 candidates, SUCCESS_PAGE, not exhausted | 3 candidates, SUCCESS_PAGE, not exhausted | CHALLENGE_BLOCKED, HTTP 403 | PARTIAL_EVIDENCE |

The second bounded cursor round for each title returned no additional
observed candidates. MangaFire remained **403 / CHALLENGE_BLOCKED**;
incomplete source evidence was preserved rather than replaced with
`NO_MATCH`, `NO_CHAPTERS`, or a fake successful result. Some healthy
sources retained `pageComplete=false` and are not exhaustively verified.
**No work had a complete three-source V2 snapshot.**

Total upstream HTTP requests across this one run (for three titles):
**MangaDex 5, MangaDot 6, MangaFire 6**, bounded, exact HTTPS source
origins, no browser/challenge bypass or cookie reuse. This demonstrates
actual runner reachability to two sources in portions of the experiment,
but no assurance the same HTTP statuses apply to a different host, time
or user device.

**Trust scope:** the official **source archive signature and bytes** are
verified, but this direct runner did *not* install a Provider. The
separate [Host Android #44739129032](https://github.com/jssantogit/tsuzuki/actions/runs/44739129032)
did authenticate the signed installation and execute actual code9 QuickJS,
but with **synthetic HTTP**, not these upstream live responses. These two
pieces of evidence are complementary, **not** proof of an integrated real
Android Reader journey.

## Post-run safety cleanup

The once-only PR branch `test/mangaall-code9-v2-real-20261120` was used
to obtain this evidence. The next commit removes the temporary PR network
trigger from `.github/workflows/mangaall-code9-v2-direct-live-diagnostics.yml`.
Subsequent upstream diagnostics require `workflow_dispatch` on the selected
branch and explicit `I_ACCEPT_LIVE_READ_ONLY`; ordinary PRs, commits and
schedules do not originate upstream requests.

Remaining: independent catalog identity/alias/author corroboration, handling
partial provider conflicts and end-to-end Host canonical/SQL/Reader testing;
real per-source chapters and CDN-pixel verification only with authorized
network and no 403 bypass. Track
[Provider #72](https://github.com/jssantogit/providers-tsuzuki/issues/72) and
[Host #207](https://github.com/jssantogit/tsuzuki/issues/207).
