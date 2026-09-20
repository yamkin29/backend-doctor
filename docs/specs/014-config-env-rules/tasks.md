# Tasks 014 — Config & env rules

TDD order: pure helpers first (things tests import come before things that
import them), then the rules that use them, then whole-pipeline
verification, close-out last.

## Tasks

- [ ] **T1. Path + gitignore helpers (AC-3, AC-1 prerequisites).**
  RED: `tests/unit/rules/config-helpers.test.ts` — `isConfigShapedPath`
  (segment, basename, negative cases), `isTestShapedPath` (resolution 2
  shapes), `isCoveredByGitignore` (literal, glob, `**/` prefix,
  directory-only line, negation, last-match-wins, comments, BOM).
  GREEN: `src/rules/config/config-paths.ts`, `src/rules/config/gitignore.ts`.
- [ ] **T2. Env-access census helper (AC-1/AC-2 prerequisite).**
  RED: census cases in `tests/unit/rules/config-helpers.test.ts` over
  synthetic sources (async-calls.test.ts precedent): member access, string
  element access, chained access reports once, whole-env read silent,
  dynamic element key silent.
  GREEN: `src/rules/config/env-usage.ts` (+ `ElementAccessExpression`
  type re-export in `src/engine/parser/types.ts`).
- [ ] **T3. `no-direct-process-env` (AC-1).**
  RED: `tests/unit/rules/config.test.ts` describe over
  `tests/fixtures/config/no-direct-process-env/{valid,invalid}/` with
  exact diagnostics; `RuleContext.relativePath` growth is exercised here.
  GREEN: `src/engine/runner.ts` (ctx.relativePath),
  `src/rules/config/no-direct-process-env.ts`, registration in
  `src/rules/index.ts` (registry count 38 → 39).
- [ ] **T4. `env-without-validation` (AC-2).**
  RED: describe over
  `tests/fixtures/config/env-without-validation/{invalid,valid-validated,valid-no-env}/`.
  GREEN: `src/rules/config/env-without-validation.ts`, registration
  (40).
- [ ] **T5. `no-committed-env` (AC-3).**
  RED: describe over
  `tests/fixtures/config/no-committed-env/{invalid,invalid-no-gitignore,valid}/`.
  Fixture `.env*` files committed with `git add -f` (design decision 7).
  GREEN: `src/rules/config/no-committed-env.ts`, registration (41).
- [ ] **T6. Pack isolation + config matrix (AC-4, AC-5).** RED: crashing
  file/project rule degrades to `internal` (characterization — engine
  behavior already exists); `ignore.rules`/`off`/`error` over a pack rule.
  GREEN: tests only expected to pass; any red here is an engine bug to
  report, not to paper over.
- [ ] **T7. Integration + e2e (AC-5, AC-6, AC-7).**
  RED→GREEN: `tests/integration/scan.test.ts` extension (staged tree, all
  three rules through `runScan`, two runs identical);
  `tests/e2e/config-rules.test.ts` (JSON diagnostics, byte-identical
  runs, `error` → exit 1, pack off → empty, jsonl diagnostics-only,
  single-file target).
- [ ] **T8. Rule docs (AC-8).** RED: doc-existence assertions in
  `config.test.ts` fail. GREEN: three docs under
  `docs/rules/backend-doctor/` in the house format with recall holes.
- [ ] **T9. Close-out.** Check off tasks, record deviations, RESEARCH.md
  entries (fixture `git add -f` gotcha, gitignore approximation, ts-morph
  facts if any), spec status → Implemented, `docs/PLAN.md` F014 → Done.

## Deviations & notes

_(filled during implementation)_
