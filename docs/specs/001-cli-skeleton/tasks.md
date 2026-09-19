# Tasks 001 — CLI skeleton & DX (F001)

- **Status:** Implemented
- **Rule:** every task was done red → green → refactor; only green states were
  committed (constitution §6).

- [x] **T1. Scaffold.** `package.json` (name, bin, engines, scripts), `tsconfig.json`
      (strict), `tsup.config.ts`, `vitest.config.ts`, `biome.json`, `pnpm-workspace.yaml`
      (esbuild build approval). Verified by: typecheck green, `vitest run
      --passWithNoTests` green, `biome check .` green. (No TDD — pure config.)
- [x] **T2. AC-1 version.** RED: e2e tests for `--version` / `-V`. GREEN:
      `bin/backend-doctor.ts` + `cli/run.ts` + `cli/version.ts`, tsup build wired into
      vitest `globalSetup`.
- [x] **T3. AC-2 pretty empty scan.** RED: e2e pretty test. GREEN: `commands/scan.ts`,
      `core/scan.ts` stub, `core/report.ts`, `core/types.ts`, `core/exit-code.ts`,
      `reporters/pretty.ts` + exact-string unit tests.
- [x] **T4. AC-3 json.** RED: e2e + contract test (exact v1 keys). GREEN:
      `reporters/json.ts`; unit contract tests for `buildReport` and the exit-code
      policy.
- [x] **T5. AC-4 jsonl.** RED: e2e empty-stdout test. GREEN: `reporters/jsonl.ts`
      (non-empty rendering covered by a unit test with two synthetic diagnostics).
- [x] **T6. AC-5/6/7/8 usage errors.** RED: four e2e tests. GREEN: `Option.choices`
      for `--format`, reserved `--config` check, scan-path existence validation —
      exit 2 everywhere. Note: AC-5 (unknown option) passed via commander +
      `exitOverride` as soon as the other three were implemented.
- [x] **T7. AC-9 stderr purity.** Covered by the shared `expectSuccess` helper
      (asserts empty stderr) used by every success-path test since T2; error paths
      assert non-empty (and path-naming) stderr.
- [x] **T8. AC-10 CI.** `.github/workflows/ci.yml`: checkout, pnpm 12, node 22,
      `biome check`, `tsc --noEmit`, `vitest run` on push/PR.
- [x] **T9. Close-out.** `docs/PLAN.md` F001 → Done; spec status → Implemented;
      deviations recorded below.

## Deviations from the original drafts

- The CI workflow landed in T8 (real checks) instead of an "empty workflow" in T1 —
  simpler than committing a placeholder first.
- tsup needs an object-form `entry` (`"bin/backend-doctor": "src/bin/…"`) to preserve
  the `dist/bin/` layout; a single array entry flattened the output.
- `expectSuccess` (AC-9 assertion) was introduced in T2 rather than retrofitted in T7.
- Environment: pnpm 12.4.2 runs via `npx -y pnpm@latest` (no global pnpm; local
  corepack has stale signing keys). esbuild's postinstall is approved in
  `pnpm-workspace.yaml` (pnpm 12 convention).
- Locked versions: biome 2.5.14, tsup 8.5.1, commander ^14, vitest ^3.
