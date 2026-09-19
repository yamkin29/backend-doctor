# Tasks 001 — CLI skeleton & DX (F001)

- **Status:** Draft — pending spec review
- **Rule:** every task is done red → green → refactor; only green states are committed
  (constitution §6).

- [ ] **T1. Scaffold.** `package.json` (name, bin, engines, scripts), `tsconfig.json`
      (strict), `tsup.config.ts`, `vitest.config.ts`, `biome.json`, empty CI workflow.
      Verified by: `pnpm vitest run` (no tests yet, exits green), `pnpm biome check .`
      green. (No TDD — pure config.)
- [ ] **T2. AC-1 version.** RED: e2e test spawning bin with `--version`. GREEN:
      `bin/backend-doctor.ts` + `cli/run.ts` stub + tsup build wired into globalSetup.
- [ ] **T3. AC-2 pretty empty scan.** RED: e2e pretty test. GREEN: `commands/scan.ts`,
      `core/scan.ts` stub, `core/report.ts`, `reporters/pretty.ts` + snapshot.
- [ ] **T4. AC-3 json.** RED: e2e + unit contract test (exact v1 keys). GREEN:
      `reporters/json.ts`.
- [ ] **T5. AC-4 jsonl.** RED: e2e empty-stdout test. GREEN: `reporters/jsonl.ts`
      (non-empty rendering covered by unit test with a synthetic diagnostic).
- [ ] **T6. AC-5/6/7/8 usage errors.** RED: four e2e tests. GREEN: `exitOverride`
      handling, path validation, format choice validation — exit 2 everywhere.
- [ ] **T7. AC-9 stderr purity.** Extend the e2e helper: every case asserts stderr is
      empty on success paths and stdout-only elsewhere.
- [ ] **T8. AC-10 CI.** `.github/workflows/ci.yml`: checkout, pnpm, `biome check`,
      `vitest run` on push/PR to main.
- [ ] **T9. Close-out.** Update `docs/PLAN.md` (F001 → Done), record any deviations
      from spec in `spec.md` (Status → Implemented).
