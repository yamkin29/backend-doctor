# Design 023 — npm publish & README (F023)

Status: written after spec approval (2026-09-22). All five open questions were
resolved by adopting the recommendations (see spec.md → Open questions).

## Module layout

| File | Change |
|------|--------|
| `package.json` | add `prepublishOnly`, `docs:rules` scripts; metadata (`author`, `repository`, `homepage`, `bugs`, `keywords`); replace `files: ["dist"]` with the explicit tarball list (T1–T2, T4) |
| `LICENSE` | new — MIT text, copyright "Copyright (c) 2026 Aleksey Yamkin" (T3, static content) |
| `README.md` | new — the package front page; structure in D6 (T3, static content) |
| `tests/unit/package-contract.test.ts` | new — pins the publish-relevant `package.json` fields and script chains exactly (T1, T2) |
| `tests/e2e/pack.test.ts` | new — pins the exact `npm pack --dry-run --json` file list (T4) |
| `docs/PLAN.md`, `docs/specs/023-…/{spec,tasks}.md` | close-out status flips (T6) |

No changes to `src/` at all: the shipped code is already correct — the feature
is packaging, metadata and documentation around it.

## Key decisions

1. **`files` is an explicit list, not `["dist"]`.**
   `["dist/bin", "dist/index.js", "dist/index.d.ts", "dist/probe", "docs/rules"]`.
   Alternative: keep `["dist"]` — rejected: it ships the maintainer-only rule-docs
   runner (OQ-2 resolved "exclude") and forgets the rule docs (OQ-3 resolved
   "ship"). `dist/bin/backend-doctor.d.ts` stays (tsup's dts build emits it into
   `dist/bin/`; excluding one generated file is fiddly and saves 20 bytes —
   boring wins). npm always adds `package.json`, `README.md` and `LICENSE` to the
   tarball regardless of `files`.
2. **The pack contract is asserted twice, at different levels.**
   `tests/unit/package-contract.test.ts` pins the *declaration* (the exact
   `files`, script chains, metadata — instant, no subprocess). `tests/e2e/pack.test.ts`
   pins the *outcome* (what `npm pack` actually reports). The unit pin gives a
   fast, focused failure when a field drifts; the e2e pin catches what the unit
   pin cannot: npm's always-include rules, dist layout changes from tsup config
   edits, stray files landing in `docs/rules/`.
3. **The pack pin spawns `npm pack --dry-run --json` and asserts only
   `files[].path`.**
   Modes/sizes are environment-dependent; the path set is the contract. Spawned
   with promisified `execFile` from the repo root (dist is fresh — vitest
   `globalSetup` built it). `--dry-run` writes no tarball (verified: repo stays
   clean after the run). npm exists wherever node does (CI installs node via
   setup-node). The test tolerates npm's JSON envelope changes by ignoring every
   field except `files`.
4. **`prepublishOnly` ends with `pnpm build`.**
   `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — build last so the
   packed `dist/` is regenerated after the suite (RESEARCH spec 021: tests must
   never mutate `dist/`, but the explicit rebuild makes the publish independent
   of that discipline). The drift check for docs already runs inside `pnpm test`
   (`tests/unit/rule-docs.test.ts`), so the chain needs no `docs:rules`.
5. **`docs:rules` is a thin alias, not new tooling.**
   `node dist/scripts/rule-docs.js --check` — the F017 runner unchanged; the alias
   just makes the maintainer workflow discoverable (`pnpm docs:rules`).
6. **README content rules.**
   English, no badges, no rule counts (they rot; the README points at
   `backend-doctor rules list`), no numbers the eval gate does not back. The
   precision claim is exactly the F022 result: zero diagnostics on the clean
   eval corpus. Every command shown is run verbatim before close-out (AC-6);
   the eight diagnostic categories are named from `DIAGNOSTIC_CATEGORIES`
   (`src/core/types.ts`).
7. **Publishing itself stays out of the code.**
   No `publishConfig`, no CI publish job, no version-bump automation. The
   feature delivers a publish-ready tree; the human runs `npm publish` from a
   clean tree (OQ-1) after renaming the GitHub repo (OQ-4). AC-5 is verified
   after that manual step, recorded in the session report.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/e2e/pack.test.ts` — pinned file list vs `npm pack --dry-run --json` |
| AC-2 | `tests/unit/package-contract.test.ts` (exact script chain) + live chain run recorded in `tasks.md` (T5) |
| AC-3 | manual tarball-install smoke, outputs recorded in `tasks.md` (T5) |
| AC-4 | existing `tests/unit/rule-docs.test.ts` + SKILL guard stay green (no new test needed — the suite is the assertion) |
| AC-5 | manual post-publish `npm view` check, recorded in the session report (after the user publishes) |
| AC-6 | manual execution of every README command, outputs recorded in `tasks.md` (T5) |
| AC-7 | `tests/unit/package-contract.test.ts` (exact `docs:rules` command) + live `pnpm docs:rules` run in T5 |

## Dependencies

None added. `npm` is invoked as an external binary by one test, not imported.
