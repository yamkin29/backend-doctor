# Tasks 003 — Engine core (F003)

- **Status:** Implemented (2026-09-19)
- **Rule:** every task runs red → green → refactor; only green states are committed
  (constitution §6).

- [x] **T1. Deps.** `pnpm add ts-morph`. Verified by: install clean, typecheck green.
      (No TDD — config.) → `ts-morph@28.0.0`.
- [x] **T2. File collection (AC-1).** RED: unit tests for `collectFiles` — extensions
      (ts/tsx/mts/cts), default excludes (node_modules, dist, build, coverage, .git),
      dotfiles respected via `dot: true`, config/CLI ignore globs, sorted output.
      GREEN: `engine/collect.ts`.
- [x] **T3. Parser adapter (AC-2).** RED: unit tests — createProject parses
      ts/tsx/mts samples from fixtures, positionOf returns 1-based line/column,
      unreadable/binary file surfaces an error the runner can skip. GREEN:
      `engine/parser/types.ts` + `engine/parser/ts-morph-adapter.ts`.
- [x] **T4. Diagnostic id + severity resolution (AC-4/5).** RED: id stability tests;
      severity matrix (rules > categories > default, off, ignore.rules). GREEN:
      `engine/diagnostic-id.ts` + `engine/severity.ts`.
- [x] **T5. Registry + runner + crash isolation (AC-6/9).** RED: unit tests with spy
      fixture rules — enabled rules run, off/ignored rules don't, throwing rule
      yields internal diagnostic + skippedChecks while siblings still run, output
      ordering deterministic. GREEN: `engine/registry.ts` + `engine/runner.ts`.
- [x] **T6. Seed rules (AC-3).** RED: fixtures for `no-eval` (direct, indirect
      `(0, eval)`, false positives: `evaluator`, `globalThis.eval` aliasing noted in
      docs) and `no-new-func`. GREEN: `rules/security/{no-eval,no-new-func}.ts` +
      registry + `docs/rules/backend-doctor/{no-eval,no-new-func}.md`.
- [x] **T7. Pipeline integration (AC-8).** RED: integration test — `runScan` on
      `tests/fixtures/engine/bad-app` returns expected diagnostics + filled
      `projects[]`. GREEN: rewrite `core/scan.ts` (stub → real pipeline). Also
      wired `REGISTERED_RULE_IDS` to the product registry so config validation
      accepts the seed rule ids.
- [x] **T8. e2e matrix (AC-7/10).** RED: bin against bad-app — pretty relative paths
      + rule ids, json diagnostics/projects shape, jsonl lines, `no-eval: error`
      config → exit 1, warn default → exit 0, two runs byte-identical. GREEN: no
      glue was left — the suite passed as written (the F001 AC-3 expectation for
      `projects: []` was updated to the F003 shape).
- [x] **T9. Close-out.** Update `docs/PLAN.md` (F003 → Done), spec status →
      Implemented, deviations recorded, tasks checked.

## Deviations from the design sketch

1. **`createProject` returns `ProjectLoadResult`** (`{ files, failures }`) instead
   of a bare `SourceFileView[]`: per-file read/binary failures must reach the
   runner as data (constitution §8) without aborting the batch. `failures` carry
   `{ filePath, reason }`.
2. **`getRelativePathTo` uses plain `path.relative`** (posix-normalized) instead of
   ts-morph's cwd-based helper — deterministic ids and ordering regardless of the
   process working directory.
3. **`Node` is re-exported as a value** from `parser/types.ts`, not type-only:
   ts-morph's type guards (`Node.isIdentifier`, …) are statics on the class and
   rules need them at runtime. The module boundary is unchanged.
4. **Traversal callback type is `(node) => "skip" | undefined`** rather than the
   sketched `void | "skip"` — Biome's `noConfusingVoidType` rejects the latter;
   rules end their visitors with an explicit `return undefined`.
5. **`skippedChecks` vocabulary** (the spec leaves it open): `check` is `"read"`
   for source-loading failures (read errors, binary content) or the rule id for
   crashed rules; `reason` starts with the target-relative file path.
6. **Crashed rules discard their partial findings** for that file — a half-run
   traversal's reports are not trustworthy; the `internal` diagnostic plus the
   skippedChecks entry keep the failure visible.
7. **Fixtures are excluded from tsc/Biome** (`tsconfig.json` exclude,
   `biome.json` files.includes) — they are scan inputs with intentionally bad
   code, not linted sources.
8. **File targets match ignore globs against the basename** — globs are defined
   against target-relative paths; for a file target that is its basename.
