# Design 002 — Config (F002)

- **Status:** Draft — pending spec review
- **Implements:** [spec.md](./spec.md)

## Module layout

```
src/
├─ index.ts                  # package entry: export { defineConfig }, types
├─ config/
│  ├─ types.ts               # SeverityOverride, UserConfig, ResolvedConfig, ConfigSource
│  ├─ validate.ts            # validateUserConfig(unknown, {knownRuleIds, sourceLabel})
│  │                         #   → UserConfig | ConfigError (field-path messages)
│  ├─ load.ts                # discovery walk, jiti/JSON loading, loadConfig(...)
│  └─ errors.ts              # ConfigError (message carries file + field path)
├─ cli/
│  ├─ commands/scan.ts       # wires loadConfig + mergeCliOverrides + --dump-config
│  ├─ commands/init.ts       # starter config writer (refuses overwrite)
│  └─ run.ts                 # registers init; scan gains --config/--dump-config
└─ core/scan.ts              # ScanInput gains `config: ResolvedConfig` (unused in F002)
```

`package.json` gains `"exports": { ".": { types, import } }`; tsup entry becomes
`{ "bin/backend-doctor": …, "index": "src/index.ts" }` so user configs can
`import { defineConfig } from "backend-doctor"` after install (F002 users may also
export a plain object — `init` writes that form, no imports needed pre-publish).

## New dependencies

- `jiti` ^2 — loads `.ts/.mts/.js/.mjs` configs without a build step (react-doctor
  precedent). Alternatives rejected: `tsx` (heavier, spawns), native
  `--experimental-strip-types` (flag- and version-sensitive).
- `picomatch` ^4 (+ `@types/picomatch` dev) — glob semantics for `ignore.files`.
  Matching is implemented now but enforced by the engine in F003.

## Key decisions

1. **`loadConfig` is a pure-ish async function with injected dependencies:**

   ```ts
   interface LoadConfigOptions {
     startDir: string;                 // scan target (file → its dirname)
     explicitPath?: string;            // --config
     knownRuleIds?: ReadonlySet<string>; // registry ids; empty until F003
   }
   // → Promise<ResolvedConfig>; throws ConfigError (message: file + field path)
   ```

   The CLI catches `ConfigError` → stderr + exit 2 (AC-13). Injection of
   `knownRuleIds` keeps rule-id validation testable while the registry is empty.

2. **Validation is hand-rolled** (no zod): a small set of type guards producing
   field-path messages (`rules["backend-doctor/x"] — unknown rule id`,
   `categories["Nope"] — unknown category`). Constitution §10: boring surface;
   zod's power is not needed for three fields, and error messages stay ours.

3. **jiti loading:** `createJiti(import.meta.url)`; `import { default, config }`
   destructure via the module namespace. Accept `default` export, named `config`,
   or defineConfig-wrapped (identity — same object). JSON via `JSON.parse` with a
   rewritten error message carrying the path.

4. **Walk-up:** `path.dirname` loop; per directory check
   `backend-doctor.config.{ts,mts,js,mjs,json}` (in that order) then
   `package.json`'s `backendDoctor` key. Stop after the directory containing `.git`
   (inclusive). Scan target file → start at its `dirname`.

5. **Precedence merge lives in one place:** `resolveCliOverrides(config, { ignoreGlobs })`
   returns a new `ResolvedConfig` with `ignore.files = [...config.ignore.files,
   ...cliGlobs]` (union, spec AC-9). `scanCommand` passes the result into
   `ScanInput.ignore` (existing field) and `ScanInput.config` (new field).

6. **`--dump-config`** renders `ResolvedConfig` via `JSON.stringify(cfg, null, 2)` +
   newline, exit 0, before any path validation (AC-11).

7. **`init`** writes a plain-object starter (no imports — resolvable before the
   package is published):

   ```ts
   /** backend-doctor configuration. Severities: "error" | "warn" | "off". */
   export default {
     rules: {},
     categories: {},
     ignore: { files: [], rules: [] },
   };
   ```

   Exit 2 if `backend-doctor.config.{ts,mts,js,mjs,json}` already exists in cwd
   (checked before writing; `package.json` keys don't block `init`).

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | unit: temp tree `root(a)/sub(b)`; config at root found from sub; dedicated file beats package key; walk stops after `.git` dir |
| AC-2 | unit: explicit path loads; e2e: missing `--config` → exit 2, message names path |
| AC-3 | unit: `.ts` via jiti (real import of `defineConfig`-less object), `.json`, `package.json` key |
| AC-4 | unit: module with only named non-`config` export → ConfigError; e2e: exit 2 |
| AC-5 | unit: unknown id in `rules` / `ignore.rules` (empty + fake-filled registry); e2e: exit 2 |
| AC-6 | unit: unknown category → ConfigError |
| AC-7 | unit: `"fatal"` severity → ConfigError with field path |
| AC-8 | unit: `ignore.files: "src"` → ConfigError |
| AC-9 | unit: mergeCliOverrides union; e2e: `--dump-config` shows union |
| AC-10 | e2e: `scan` with valid `.ts` config → same output/exit as spec 001 |
| AC-11 | e2e: `--dump-config` → JSON on stdout, exit 0, no scan output |
| AC-12 | e2e: `init` creates file (content matches starter); second `init` → exit 2 |
| AC-13 | e2e: every config-error case asserts empty stdout |

## Version pinning

`jiti` ^2, `picomatch` ^4. `engines` unchanged (node >=20; jiti 2 needs >=18).
