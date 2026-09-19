# Tasks 002 — Config (F002)

- **Status:** Draft — pending spec review
- **Rule:** every task runs red → green → refactor; only green states are committed
  (constitution §6).

- [ ] **T1. Deps & package surface.** Add `jiti`, `picomatch` (+`@types/picomatch`);
      `package.json` `exports` field; tsup entry `index`. Verified by: build emits
      `dist/index.js`, typecheck/lint green. (No TDD — config.)
- [ ] **T2. Validation (AC-5/6/7/8).** RED: unit tests for `validateUserConfig` —
      valid config, unknown rule id (`rules` and `ignore.rules`, empty and filled
      registry), unknown category, bad severity, non-array ignores; each error message
      carries source label + field path. GREEN: `config/errors.ts` + `config/validate.ts`.
- [ ] **T3. Discovery & loading (AC-1/3).** RED: unit tests on temp trees — walk-up
      with `.git` stop, dedicated file beats `package.json` key, jiti loads real
      `.ts` config, `.json` loads, `package.json` key loads, nothing found →
      defaults. GREEN: `config/load.ts`.
- [ ] **T4. Explicit path & module shape (AC-2/4).** RED: unit tests — explicit path
      loaded directly; missing explicit path → ConfigError naming it; module without
      `default`/`config` export → ConfigError. GREEN: extend `config/load.ts`.
- [ ] **T5. CLI override merge (AC-9).** RED: unit tests for `resolveCliOverrides`
      union semantics (empty config, config+flags, duplicate globs deduplicated?).
      GREEN: `config/resolve.ts`.
- [ ] **T6. Scan wiring + `--dump-config` (AC-10/11).** RED: e2e — `scan` with valid
      `.ts` config unchanged behavior; `--dump-config` prints JSON with `source` and
      unioned ignores, exit 0, no scan output. GREEN: wire `loadConfig` +
      `resolveCliOverrides` into `commands/scan.ts`; `ScanInput.config`.
- [ ] **T7. Config error paths via CLI (AC-13).** RED: e2e — missing `--config`,
      bad severity, unknown rule id, bad module shape → exit 2, message content,
      empty stdout. GREEN: `ConfigError` handling in `run.ts`.
- [ ] **T8. `init` (AC-12).** RED: e2e — creates starter file with exact content;
      refuses to overwrite (exit 2). GREEN: `commands/init.ts` + registration.
- [ ] **T9. Close-out.** Update `docs/PLAN.md` (F002 → Done), spec status →
      Implemented, deviations recorded, tasks checked.
