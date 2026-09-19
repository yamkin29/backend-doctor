# Tasks 003 — Engine core (F003)

- **Status:** Draft — pending spec review
- **Rule:** every task runs red → green → refactor; only green states are committed
  (constitution §6).

- [ ] **T1. Deps.** `pnpm add ts-morph`. Verified by: install clean, typecheck green.
      (No TDD — config.)
- [ ] **T2. File collection (AC-1).** RED: unit tests for `collectFiles` — extensions
      (ts/tsx/mts/cts), default excludes (node_modules, dist, build, coverage, .git),
      dotfiles respected via `dot: true`, config/CLI ignore globs, sorted output.
      GREEN: `engine/collect.ts`.
- [ ] **T3. Parser adapter (AC-2).** RED: unit tests — createProject parses
      ts/tsx/mts samples from fixtures, positionOf returns 1-based line/column,
      unreadable/binary file surfaces an error the runner can skip. GREEN:
      `engine/parser/types.ts` + `engine/parser/ts-morph-adapter.ts`.
- [ ] **T4. Diagnostic id + severity resolution (AC-4/5).** RED: id stability tests;
      severity matrix (rules > categories > default, off, ignore.rules). GREEN:
      `engine/diagnostic-id.ts` + `engine/severity.ts`.
- [ ] **T5. Registry + runner + crash isolation (AC-6/9).** RED: unit tests with spy
      fixture rules — enabled rules run, off/ignored rules don't, throwing rule
      yields internal diagnostic + skippedChecks while siblings still run, output
      ordering deterministic. GREEN: `engine/registry.ts` + `engine/runner.ts`.
- [ ] **T6. Seed rules (AC-3).** RED: fixtures for `no-eval` (direct, indirect
      `(0, eval)`, false positives: `evaluator`, `globalThis.eval` aliasing noted in
      docs) and `no-new-func`. GREEN: `rules/security/{no-eval,no-new-func}.ts` +
      registry + `docs/rules/backend-doctor/{no-eval,no-new-func}.md`.
- [ ] **T7. Pipeline integration (AC-8).** RED: integration test — `runScan` on
      `tests/fixtures/engine/bad-app` returns expected diagnostics + filled
      `projects[]`. GREEN: rewrite `core/scan.ts` (stub → real pipeline).
- [ ] **T8. e2e matrix (AC-7/10).** RED: bin against bad-app — pretty relative paths
      + rule ids, json diagnostics/projects shape, jsonl lines, `no-eval: error`
      config → exit 1, warn default → exit 0, two runs byte-identical. GREEN: any
      remaining glue.
- [ ] **T9. Close-out.** Update `docs/PLAN.md` (F003 → Done), spec status →
      Implemented, deviations recorded, tasks checked.
