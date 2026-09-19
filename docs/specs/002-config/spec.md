# Spec 002 — Config (F002)

- **Status:** Draft — pending review
- **Phase:** 0 — Foundation
- **Depends on:** F001 (CLI skeleton) — Done
- **Blocks:** F003 (engine core consumes the resolved config)

## Problem

The CLI has no configuration surface: users cannot tune severities, silence rules, or
exclude files. F002 introduces the config contract (`backend-doctor.config.ts` with a
`defineConfig` helper, `.json`, and a `package.json` key), its discovery rules, and
validation — so that the engine (F003) can consume a fully validated `ResolvedConfig`
without knowing where it came from.

## Goals

- Config discovery with walk-up resolution, stopping at the repository root.
- Supported sources: `backend-doctor.config.{ts,mts,js,mjs}` (loaded via jiti),
  `backend-doctor.config.json`, and a `backendDoctor` key in `package.json`.
- Fields: `rules` (per-rule severity), `categories` (per-category severity),
  `ignore.files` (globs), `ignore.rules` (rule ids to silence).
- Validation with actionable error messages (config path + field path), exit 2.
- CLI integration: `--config <path>` becomes functional; `--ignore` flags union with
  `ignore.files`.
- `defineConfig` exported from the package entry for typed user configs.
- Observability: `--dump-config` prints the resolved config as JSON.
- `backend-doctor init` scaffolds a starter config.

## Non-goals

- Applying rules/severities/ignores to diagnostics — the engine lands in F003; F002
  only produces and validates the resolved config.
- `.jsonc` config files, `$schema` publishing (later, when the surface settles).
- Config inheritance/extends, environment-specific overrides.
- Watching/reloading configs.

## User stories

1. As a backend developer, I put a `backend-doctor.config.ts` in my repo root, mark a
   noisy rule as `"off"`, and every scan in the repo respects it.
2. As a developer in a monorepo subpackage, I run `backend-doctor scan .` from the
   subpackage and my nearest config wins over the repo-root one.
3. As a CI author, I pass `--config configs/strict.ts` explicitly and get exit 2 with
   a precise message when the config is invalid.
4. As an AI agent, I run `backend-doctor scan . --dump-config` to see the effective
   configuration before interpreting results.

## CLI contract changes (v1 → v1.1)

```
backend-doctor scan [path] [--format …] [--ignore <glob>]... [--config <path>] [--dump-config]
backend-doctor init
```

- `--config <path>`: load exactly this file (any supported format); walk-up discovery
  is skipped. Previously a reserved flag erroring with a F002 pointer.
- `--dump-config`: print the resolved config as JSON to stdout and exit 0; no scan is
  performed and scan-path validation is skipped.
- `init`: create `backend-doctor.config.ts` in cwd; refuses to overwrite (exit 2).

## Config model

```ts
type SeverityOverride = "error" | "warn" | "off";

interface UserConfig {
  rules?: Record<string, SeverityOverride>;          // by rule id ("backend-doctor/x")
  categories?: Record<DiagnosticCategory, SeverityOverride>;
  ignore?: { files?: string[]; rules?: string[] };
}

interface ResolvedConfig {
  rules: Record<string, SeverityOverride>;           // normalized, always present
  categories: Partial<Record<DiagnosticCategory, SeverityOverride>>;
  ignore: { files: string[]; rules: string[] };
  source: { kind: "default" | "file" | "packageJson"; path: string | null };
}
```

- `ignore.rules` is sugar for `rules[id] = "off"`; both may be used, effect is union.
- Glob semantics for `ignore.files`: picomatch, `dot: true`, matched against paths
  relative to the config file's directory. (Matching itself is applied by the engine
  from F003; F002 only validates and carries the globs.)

## Discovery & precedence

1. If `--config <path>` is given: load exactly that file; missing → exit 2.
2. Otherwise, walk up from the scan target (file → its directory) checking each
   directory for `backend-doctor.config.{ts,mts,js,mjs,json}` then the `backendDoctor`
   key in that directory's `package.json`. **First match wins**; a dedicated config
   file beats a `package.json` key in the same directory.
3. The walk stops **after** the nearest ancestor directory containing `.git`
   (repository root) to avoid picking up unrelated configs above the repo; if no
   `.git` is found, it continues to the filesystem root.
4. Nothing found → defaults (all fields empty, `source.kind: "default"`).
5. CLI flags: `--ignore` values are **added to** (unioned with)
   `config.ignore.files`. Scalar/choice flags would override; there are none in F002.

## Validation & errors

All config errors are **exit 2** (constitution §5) with a message containing the
config file path and the offending field path, e.g.
`backend-doctor.config.ts: rules["backend-doctor/nope"] — unknown rule id`.
Unknown rule ids are validated against the registered rule set (injected; empty until
F003 adds rules). Unknown categories, invalid severity values, non-string-array
`ignore` fields and a config module exporting neither `default` nor `config` are all
config errors.

## EARS acceptance criteria

- **AC-1:** WHEN `scan` runs without `--config`, THE SYSTEM SHALL discover config by
  walking up from the scan target to the repository root (nearest ancestor with
  `.git`, inclusive; filesystem root if none), first match wins, and a dedicated
  config file SHALL beat a `package.json` key in the same directory.
- **AC-2:** WHEN `--config <path>` is provided, THE SYSTEM SHALL load exactly that
  file, and if it does not exist SHALL exit 2 naming the path.
- **AC-3:** WHEN a config source is `.ts`, `.mts`, `.js`, `.mjs`, `.json` or a
  `package.json` `backendDoctor` key, THE SYSTEM SHALL load it (TS via jiti, without
  requiring a tsconfig in the user project).
- **AC-4:** WHEN a TS/JS config module exports neither `default` nor `config`,
  THE SYSTEM SHALL exit 2 naming the file.
- **AC-5:** WHEN `rules` or `ignore.rules` references an unregistered rule id,
  THE SYSTEM SHALL exit 2 listing the id and the config path.
- **AC-6:** WHEN `categories` contains an unknown category name, THE SYSTEM SHALL
  exit 2 naming it.
- **AC-7:** WHEN a severity value is not `error|warn|off`, THE SYSTEM SHALL exit 2
  naming the field path.
- **AC-8:** WHEN `ignore.files`/`ignore.rules` are present but not string arrays,
  THE SYSTEM SHALL exit 2 naming the field path.
- **AC-9:** WHEN both config `ignore.files` and CLI `--ignore` are present,
  THE SYSTEM SHALL use their union as the effective ignore globs.
- **AC-10:** WHEN a valid config is present, THE SYSTEM SHALL keep scan exit codes and
  output formats unchanged (F002 wires the config through; the engine consumes it in
  F003).
- **AC-11:** WHEN `--dump-config` is passed, THE SYSTEM SHALL print the resolved
  config (including `source`) as JSON to stdout and exit 0 without scanning.
- **AC-12:** WHEN `init` runs in a directory without a config file, THE SYSTEM SHALL
  create `backend-doctor.config.ts` with a commented starter; WHEN one already exists
  in cwd, THE SYSTEM SHALL exit 2 and not overwrite.
- **AC-13:** WHEN any config error occurs, THE SYSTEM SHALL exit 2 and write the
  message to stderr only (stdout stays report-only, AC-9 of spec 001).

## Testing strategy (TDD)

- Unit tests build real temp directory trees on disk and exercise discovery,
  precedence, jiti loading of actual `.ts` configs, and validation messages (field
  paths present). `knownRuleIds` is injected as a `Set<string>` so rule-id validation
  is testable before real rules exist.
- e2e tests spawn the built bin: happy path (`scan` with a valid config, exit 0),
  `--dump-config` (resolved union + source), every error path (exit 2 + message
  content), `init` create/refuse.
- Fixtures: temp dirs per test; no committed fixtures.

## Open questions for review

1. `--dump-config` (proposed): makes the resolved config observable e2e while the
   engine has zero rules; also useful for agents. Alternative: keep config invisible
   until F003.
2. `init` command in F002 (proposed): repo structure already lists `init` among
   commands; writing the starter config is its natural home. Alternative: defer to
   F023.
3. `--ignore` union semantics (additive) vs full override. Recommendation: union.
4. Unknown rule ids as hard errors (exit 2) vs warnings. Recommendation: hard error
   (constitution: fail loud) — note this means any `rules` key errors until F003
   registers rules.
5. New runtime dependencies: `jiti` (TS config loading, react-doctor precedent) and
   `picomatch` (glob semantics), plus `@types/picomatch`.
