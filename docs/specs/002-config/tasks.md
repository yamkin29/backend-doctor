# Tasks 002 — Config (F002)

- **Status:** Implemented
- **Rule:** every task ran red → green → refactor; only green states were committed
  (constitution §6).

- [x] **T1. Deps & package surface.** `jiti` ^2, `picomatch` ^4 (+`@types/picomatch`);
      `package.json` `exports` with types; tsup entry `index` with `dts: true`;
      `src/index.ts` (defineConfig) + `src/config/types.ts`. Verified by: build emits
      `dist/index.js` + `dist/index.d.ts`, typecheck/lint green.
- [x] **T2. Validation (AC-5/6/7/8).** RED: unit tests for `validateUserConfig`.
      GREEN: `config/errors.ts` + `config/validate.ts` (+ `normalizeConfig`).
      Fix during green: unknown-id message for `ignore.rules` now includes the id.
- [x] **T3. Discovery & loading (AC-1/3).** RED: unit tests on real temp trees.
      GREEN: `config/load.ts` — walk-up with `.git` boundary, file beats package key,
      jiti for `.ts/.mts/.js/.mjs`, JSON.parse for `.json`, package.json key.
- [x] **T4. Explicit path & module shape (AC-2/4).** RED: explicit-path tests (and a
      shape test that exposed a real bug). GREEN: `explicitPath` branch + strict
      module-shape extraction.
      **Key finding:** jiti exposes a *virtual* `default` (the module itself) when no
      default export exists, so `isObject(mod.default)` was true even for
      default-less configs. Fixed by requiring an *own* `default` property
      (`getOwnPropertyNames`). Named `config` export and CJS plain objects supported;
      default/config-less ESM modules now fail loudly.
- [x] **T5. CLI override merge (AC-9).** RED: unit tests for `resolveCliOverrides`.
      GREEN: union with dedupe, config order first, input untouched.
- [x] **T6. Scan wiring + `--dump-config` (AC-10/11).** RED: e2e dump tests.
      GREEN: `scanCommand` loads/validates config, merges CLI overrides, dumps
      resolved JSON (exit 0, no scan); `ScanInput` gained `config`; F001's reserved
      `--config` test evolved to the functional contract (missing file → exit 2
      naming path).
- [x] **T7. Config error paths via CLI (AC-13).** Characterization coverage —
      `ConfigError` handling landed with the T6 wiring (it guards the dump path).
      Tests lock: bad severity, unknown rule id, shape-less module, invalid JSON —
      all exit 2 with stdout clean.
- [x] **T8. `init` (AC-12).** RED: e2e. GREEN: `commands/init.ts` (import-free
      starter, refuses overwrite, package.json key alone does not block).
- [x] **T9. Close-out.** `docs/PLAN.md` F002 → Done; spec status → Implemented;
      deviations recorded below.

## Deviations & notes

- T7 was characterization, not red→green: `ConfigError` → exit-2 wiring was required
  by T6's dump path and landed there.
- Part of T4's module-shape logic existed since T3's `extractDefaultOrConfig`; the
  jiti virtual-default bug surfaced from the T4 test and was fixed in T4.
- tsup `dts: true` added so `exports.types` works; `jiti` kept `external` (its loader
  machinery must run as the real dependency, not bundled).
- The bin shebang moved from a global tsup banner into the bin source (a banner would
  also have stamped the library entry `dist/index.js`).
- Verified live: `scan --dump-config` (defaults + discovered config), `init`
  (create/refuse), `scan --format json` with a config present.
