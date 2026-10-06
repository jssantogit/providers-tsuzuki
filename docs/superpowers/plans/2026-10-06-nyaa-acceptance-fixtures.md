# Nyaa Acceptance Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nyaa discovery behavior deterministic and diagnosable in Provider CI so query-order, raw-item acceptance and budget regressions are caught without a device or live Nyaa.

**Architecture:** Keep all Nyaa-specific semantics inside `providers-tsuzuki`. Extend the existing Node fixture harness rather than changing Host contracts, and expose only bounded test diagnostics (attempt phase, raw RSS item count, accepted candidate count, elapsed fake time/request count). Production search semantics remain unchanged except for defects first reproduced by a failing fixture.

**Tech Stack:** Node.js 22, JavaScript ES modules, existing Provider fixture harness.

**Spec:** `jssantogit/tsuzuki:docs/superpowers/specs/2026-10-06-provider-torrent-acceptance-harness-design.md`

## Global Constraints

- Required CI must not call live Nyaa, public trackers or public peers.
- Keep the Host 5000 ms wall-clock and Provider 2500 ms discovery soft budget unchanged.
- Do not weaken magnet/infoHash validation or multi-file fail-closed behavior.
- Do not add raw user titles, private URLs, cookies or secrets to persistent diagnostics.
- Production behavior changes require a RED fixture first.

## Review Focus

- RSS contains valid `<item>` blocks but all are rejected: fixture must distinguish raw item count from accepted candidates.
- Primary narrow query is slow/empty: required primary title-only fallback must still execute while later aliases remain bounded.
- Malformed or mismatched magnet link: candidate must remain rejected.
- Empty RSS across many aliases: request count must stay bounded and must not walk all stored aliases.
- Detail HTML describes multiple files: Provider must not invent an exact file index.

---

### Task 1: Consolidate Nyaa fixture observability

**Files:**
- Modify: `tooling/test_nyaa.mjs`
- Create: `tooling/nyaa_fixture_harness.mjs`
- Modify: `tooling/test_nyaa_runtime_budget.mjs`
- Modify: `tooling/test_nyaa_slow_primary_fallback.mjs`

**Interfaces:**
- Produces: `runNyaaFixture({ responses, now, input })` returning `{ result, requests, trace }`.
- `trace` entries contain only `{ phase, rawItemCount, acceptedCandidateCount, elapsedMs }`.

- [ ] **Step 1: Write failing harness tests**

Add assertions proving one controlled RSS response with two raw items, one valid and one invalid, yields `rawItemCount = 2`, `acceptedCandidateCount = 1`, and preserves the existing candidate result.

- [ ] **Step 2: Run the existing Nyaa fixture command and verify RED**

Run in CI-equivalent environment: `node tooling/test_nyaa.mjs`

Expected: FAIL because the shared fixture trace does not exist yet.

- [ ] **Step 3: Implement the minimal shared fixture harness**

Create `runNyaaFixture(...)` as test-only orchestration around the production `providers/nyaa/main.js`. Do not copy production parser logic into the helper.

- [ ] **Step 4: Migrate budget/fallback fixtures to the helper**

Keep their current request-order expectations exactly intact while adding trace assertions.

- [ ] **Step 5: Verify GREEN**

Run:
- `node tooling/test_nyaa.mjs`
- `node tooling/test_nyaa_runtime_budget.mjs`
- `node tooling/test_nyaa_slow_primary_fallback.mjs`

Expected: all print their `OK` completion line and exit 0.

- [ ] **Step 6: Commit**

Commit message: `test(nyaa): consolidate acceptance fixture diagnostics`

### Task 2: Pin raw-item acceptance and budget failure classes

**Files:**
- Create: `tooling/test_nyaa_item_acceptance.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify only if RED proves a defect: `providers/nyaa/main.js`
- Modify only if production changes: `providers/nyaa/manifest.json`

**Interfaces:**
- Consumes: `runNyaaFixture(...)` from Task 1.
- Produces: blocking Provider CI coverage for zero raw items, rejected raw items, accepted magnet/infoHash item, multi-file fail-closed detail mapping and bounded alias traversal.

- [ ] **Step 1: Add a failing item-acceptance matrix**

The new fixture must assert:
1. zero raw items -> zero accepted candidates;
2. valid RSS item with matching BTIH -> one accepted candidate;
3. mismatched BTIH -> raw count one, accepted zero;
4. invalid `/view/` guid -> raw count one, accepted zero;
5. single CBZ detail page -> exact `files[0]`;
6. multiple files/folder -> candidate remains without `files`.

- [ ] **Step 2: Run the new fixture and verify RED where coverage exposes missing behavior**

Run: `node tooling/test_nyaa_item_acceptance.mjs`

Expected: FAIL until the matrix/harness behavior is complete; any production semantic defect must be demonstrated by a specific assertion before touching `main.js`.

- [ ] **Step 3: Make only the minimal production correction required by RED**

If all semantics already pass, do not edit `providers/nyaa/main.js`.

- [ ] **Step 4: Add the new fixture to Provider CI**

Insert one named step after the existing Nyaa contract fixture in `.github/workflows/ci.yml`.

- [ ] **Step 5: Verify the complete Provider suite**

Run the commands from `.github/workflows/ci.yml` in order.

Expected: all fixture/conformance commands exit 0; no repository sequence is published by this branch.

- [ ] **Step 6: Commit**

Commit message: `test(nyaa): cover item acceptance and bounded discovery`
