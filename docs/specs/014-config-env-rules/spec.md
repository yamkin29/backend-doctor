# Spec 014 — Config & env rules (F014)

- **Status:** Draft — pending review
- **Phase:** 3 — Project-level (opt-in, full scan)
- **Depends on:** F003 (engine core: adapter, registry, runner, report) —
  Done; F013 (project rule kind, package-surface reading precedent) — Done;
  F002 (config severity/ignore matrix) — Done; F006/F007 (AST rule and
  helper patterns, `isInsideFunctionLike`, fixture conventions) — Done
- **Blocks:** F017 (rule docs + jsonl consume this pack), F022 (eval corpus
  gates the precision of the pack)

## Problem

Environment configuration is where Node backends fail at runtime, and the
shipped packs cannot see any of its failure modes. Three defects from the
PLAN line:

1. `process.env` is read directly in business code, so defaults, naming and
   validation of configuration end up scattered across services and
   handlers — there is no single place where configuration lives.
2. Environment variables are read but never validated against a schema, so
   a missing or misspelled variable surfaces as a production crash instead
   of a startup error.
3. A dotenv file sits at the package root without `.gitignore` coverage —
   its real credentials are one `git add .` away from the repository (the
   same failure class `no-hardcoded-secrets` guards against in source).

The engine already has both rule kinds, per-file AST traversal, module
specifiers and the package root; RESEARCH reserves exactly this feature
line. What is missing is the third pack on top.

## Goals

- Three new rules, all default `warn` (constitution §2), framework-free
  (no `frameworks` gate — env mistakes are not Nest-specific), in a new
  `src/rules/config/` module (the `config/` dir is reserved in the PLAN
  layout):
  - `backend-doctor/no-direct-process-env` — **file rule** (Category
    `Configuration`). Flags every direct access of the exact shapes
    `process.env.<Identifier>` and `process.env["<StringLiteral>"]`
    (identifier root `process`, member `env`) in an analyzed file whose
    target-relative path is **not config-shaped**: config-shaped means any
    `/`-separated path segment equal (lowercased) to `config`, `configs`,
    `configuration`, `configurations`, `env`, `environments`, `settings`,
    or a basename (lowercased, extension stripped) containing `config`,
    `env` or `settings`. One diagnostic per access site. Whole-env reads
    (`const vars = process.env`, destructuring), element access with
    non-literal keys, other roots (`globalThis.process`), and type-level
    references stay silent (documented recall holes).
  - `backend-doctor/env-without-validation` — **project rule** (Category
    `Configuration`). Collects the env-access census (same shapes as
    above) over all analyzed files; WHEN the census is non-empty and NO
    analyzed file imports one of the pinned validation libraries
    (`zod`, `class-validator`, `joi`, `envalid`, `convict`, `env-schema`
    — exact module specifiers or subpaths), THE SYSTEM reports exactly one
    diagnostic positioned at the **first** env access in file-sorted
    traversal order, with the total read count in the message. Any pinned
    import anywhere silences the rule (precision-first: partial or
    cross-file validation counts as validated — documented recall hole).
  - `backend-doctor/no-committed-env` — **project rule** (Category
    `Security`). For the fixed candidate list of standard dotenv names at
    the package root — `.env`, `.env.local`, `.env.development`,
    `.env.development.local`, `.env.production`, `.env.production.local`,
    `.env.test`, `.env.test.local` — reports one diagnostic per file that
    exists and is **not covered** by the package-root `.gitignore`.
    Coverage uses approximate gitignore semantics sufficient for
    root-level filenames: comment/blank lines skipped; lines matched in
    order, **last match wins**; a leading `/` is stripped; a trailing `/`
    marks a directory-only pattern and never matches a file; a line
    containing glob metacharacters (`*`, `?`, `[`) matches via picomatch
    (already a dependency) with `dot: true` against the candidate name;
    otherwise the line matches by exact basename. A `!pattern` negation
    un-covers the candidate. When no `.gitignore` exists at the package
    root, every present candidate reports. `.env.example`-style names are
    not candidates. The diagnostic is reported against the dotenv file
    itself at 1:1.
- No report, CLI, config-field, exit-code, or `schemaVersion` changes: the
  three rule ids are the only new surface; `src/index.ts` public exports
  are untouched. Registry count grows 38 → 41.
- Parser boundary grows by one **type-only** re-export:
  `ElementAccessExpression` (needed for `process.env["KEY"]`) — the
  adapter-grows-first rule (constitution §4). No runtime adapter changes.
- Determinism (constitution §1): fixed candidate list, sorted file
  iteration, positions from the adapter, picomatch on fixed inputs — two
  scans are byte-identical.

## Non-goals

- Reading or parsing dotenv file **contents** (secret scanning inside
  `.env`, key censuses): the rule is presence-based. Content analysis is
  not in the PLAN line and duplicates `no-hardcoded-secrets`' charter for
  a file type the engine does not parse.
- Full gitignore semantics: nested `.gitignore` files above the package
  root, `.git/info/exclude`, global/core excludes, `git check-ignore`
  subprocess. Package-root `.gitignore` only — a monorepo whose
  covering pattern lives at the repo root is a documented recall hole.
- Recognizing hand-rolled validation (`if (!process.env.PORT) throw …`)
  or cross-file schema wiring: detection is import-syntax-only; F022 is
  the precision gate, and a rule that cries wolf on the good corpus gets
  fixed or demoted (constitution §2).
- Framework-aware config checks (verifying adoption of
  `@nestjs/config`/`ConfigService`, analyzing `ConfigModule.forRoot`
  validation schemas): not in the PLAN line; future pack work.
- Writes to `process.env` (test setup, bootstrapping) as a separate
  concern, `dotenv.config()` call analysis, auto-fix/`.env.example`
  generation.
- New dependencies, contract changes (exit codes, `schemaVersion`, config
  fields, CLI surface).

## User stories

1. As a backend developer, I run `backend-doctor scan .` and see each
   scattered `process.env` access in business code pointing me to move it
   into my config module (while `src/config/*`, `app.config.ts` and my
   tests stay silent), one clear finding when the codebase reads the
   environment but no validation library anywhere, and a warning when a
   dotenv file at my package root is not covered by `.gitignore`.
2. As a CI author, the pack behaves like every other pack: `warn` by
   default so exit code stays 0 until I promote rules, `--format
   json|jsonl` unchanged, consecutive runs byte-identical, and a crashing
   config rule degrades to an `internal` diagnostic instead of failing
   the build.
3. As an AI agent, I consume the same JSON/JSONL as before — no new schema
   surface — and every finding cites a rule doc at
   `docs/rules/backend-doctor/<rule-id>.md`.

## Contract / Model

No changes to the JSON report, diagnostic shape, CLI surface, config
fields, or exit codes. New stable surfaces: the three rule ids (default
severity `warn` for all).

| Rule id | Kind | Category | Fires at |
|---|---|---|---|
| `backend-doctor/no-direct-process-env` | file | Configuration | each `process.env.<name>` / `process.env["<name>"]` access in a non-exempt file |
| `backend-doctor/env-without-validation` | project | Configuration | first env access in the analyzed set (1 diagnostic total) |
| `backend-doctor/no-committed-env` | project | Security | each uncovered candidate dotenv file at the package root (1:1) |

### Detection details (snapshot-pinned)

- **Env access shapes** (shared helper, both file- and project-side):
  a `PropertyAccessExpression` whose text chain is `process` → `env` →
  `<Identifier>`, or an `ElementAccessExpression` over `process.env` with
  a single `StringLiteral` argument. The reported position is the outer
  access node's start.
- **Config-shaped path exemption** (file rule only): target-relative
  posix path; any segment (lowercased) in `{config, configs,
  configuration, configurations, env, environments, settings}` OR
  basename without extension (lowercased) containing `config`, `env` or
  `settings`. Test-shaped exemption per open question 2.
- **Pinned validation libraries** (project rule): `zod`,
  `class-validator`, `joi`, `envalid`, `convict`, `env-schema` — a file's
  module specifiers match by exact specifier or `name/…` subpath prefix.
- **Dotenv candidates** (project rule): the 8 fixed names listed in
  Goals, at `packageRoot` only (fallback: scan target, per
  `findPackageRoot`).

Message templates (exact strings, snapshot-pinned):

- `no-direct-process-env`: `process.env is read directly in business
  code; route the value through your config module so defaults and
  validation live in one place.`
- `env-without-validation`: `Environment variables are read in <N>
  place(s) but never validated; a missing or misspelled variable surfaces
  as a runtime failure. Parse the whole environment with a schema (zod,
  class-validator, envalid) in your config module.`
- `no-committed-env`: `<name> exists at the package root and is not
  covered by .gitignore; dotenv files carry real credentials and end up
  committed by accident. Add it to .gitignore, rotate any credential it
  ever held, and keep a committed .env.example instead.`

## EARS acceptance criteria

- **AC-1:** WHEN an analyzed file that is neither config-shaped nor
  test-shaped (per resolution) contains a `process.env.<Identifier>` or
  `process.env["<StringLiteral>"]` access, THE SYSTEM SHALL report
  exactly one `no-direct-process-env` diagnostic (warn, Configuration) at
  the access node; WHEN the file is config-shaped or test-shaped, or the
  read is a whole-env access (no member/element access), THE SYSTEM SHALL
  NOT report.
- **AC-2:** WHEN the analyzed file set contains at least one env access
  and no analyzed file imports a pinned validation library, THE SYSTEM
  SHALL report exactly one `env-without-validation` diagnostic (warn,
  Configuration) at the first env access in file-sorted traversal order,
  naming the total read count; WHEN a pinned library is imported anywhere
  in the analyzed set, or the census is empty, THE SYSTEM SHALL NOT
  report.
- **AC-3:** WHEN a candidate dotenv file exists at the package root and
  the package-root `.gitignore` does not cover it (or no `.gitignore`
  exists there), THE SYSTEM SHALL report exactly one `no-committed-env`
  diagnostic (warn, Security) against that file at 1:1; WHEN the file is
  absent, not a candidate name, or covered by `.gitignore` (including via
  a glob pattern, with last-match-wins and `!` negation), THE SYSTEM
  SHALL NOT report.
- **AC-4:** WHEN a config-pack rule's `create`/`analyze` throws, THE
  SYSTEM SHALL emit one `internal` diagnostic and a `skippedChecks` entry
  for it and keep every other rule's findings (constitution §8).
- **AC-5:** WHEN the tree contains none of the pack's triggers, THE
  SYSTEM SHALL produce no diagnostics from this pack; config
  `ignore.rules`/severity `off` silence a pack rule and severity `error`
  escalates it (exit code 1 when such diagnostics exist) — the same
  resolution matrix as every other pack.
- **AC-6:** WHEN the same tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports.
- **AC-7:** WHEN the scan target is a single file or a tree without
  `package.json`/`.gitignore`, THE SYSTEM SHALL run the pack without
  crashing (no candidates → `no-committed-env` silent; no package root
  → packageRoot falls back to the scan target).
- **AC-8:** WHEN the feature ships, every pack rule SHALL have `valid/`
  and `invalid/` fixtures, snapshot tests of the exact diagnostics
  (file, line, column, message), and a markdown doc at
  `docs/rules/<rule-id>.md` (constitution §3).

## Testing strategy (TDD)

- **Fixtures.** New fixture root `tests/fixtures/config/<rule-id>/
  {valid,invalid}/` (the `graph/` precedent: shaped by what the analysis
  needs — project rules get multi-file trees):
  - `no-direct-process-env/` — invalid: a service file with
    `process.env.DATABASE_URL` and `process.env["API_URL"]`; valid:
    `src/config/settings.ts` and `app.config.ts` reading env freely, a
    test-shaped file, a whole-env read, an element access with a dynamic
    key.
  - `env-without-validation/` — invalid: multi-file tree (`config/`
    reads + `main.ts` read, no validation import); valid: the same tree
    with a zod-importing validation file, and a tree without any env
    read.
  - `no-committed-env/` — invalid: package root with `.env` and
    `.env.local`, a `.gitignore` covering neither; valid: `.env` covered
    by a literal `.gitignore` line, `.env.production` covered by
    `.env.*`, a `.env.example` present, and a no-gitignore tree with no
    dotenv file. **Gotcha:** the repo `.gitignore` ignores `.env` and
    `.env.*`, so fixture dotenv files must be committed with
    `git add -f` (recorded in `docs/RESEARCH.md` at implementation).
- **Unit** — new `tests/unit/rules/config.test.ts`: the three rules over
  the fixture trees with exact diagnostics; the gitignore matcher and
  the config-shape/test-shape path predicates as direct helper tests
  (glob lines, negation, directory-only lines, last-match-wins); the
  fail-soft isolation case (AC-4); the config off/error cases (AC-5);
  fixture/doc existence (AC-8). Registry count 38 → 41 in the existing
  registry assertion (`tests/unit/rules/blocking.test.ts`).
- **Integration** — extend `tests/integration/scan.test.ts`: a staged
  tree with a scattered env read, an unvalidated census and an
  un-ignored `.env` produces all three through `runScan`;
  determinism of the combined report (AC-6).
- **e2e** — new `tests/e2e/config-rules.test.ts` via
  `runCli`/`makeTmpDir`/`expectSuccess`: JSON diagnostics for the three
  violations (temp trees, so the repo `.gitignore` is irrelevant); two
  runs byte-identical (AC-6); `off`/`error` overrides incl. exit 1
  (AC-5); jsonl stays diagnostics-only; a single-file scan target does
  not crash (AC-7).
- **Docs** — three rule docs under `docs/rules/backend-doctor/` in the
  existing format, with the recall holes (whole-env reads, dynamic keys,
  `globalThis.process`, hand-rolled validation, repo-root gitignore)
  written down. Durable findings (fixture `-f` gotcha, gitignore
  approximation semantics) go to `docs/RESEARCH.md`.
- **Adapter growth** — one type-only re-export
  (`ElementAccessExpression` in `src/engine/parser/types.ts`); positions
  come from the existing `positionOf`/`getStart()` machinery; no runtime
  adapter changes.

## Open questions for review

1. **"Opt-in" (PLAN phase header) vs. warn-by-default.** Same question as
   spec 013, resolved there as "ship enabled at warn". Recommendation:
   all three rules enabled at `warn` like every existing pack (exit code
   stays 0 until promoted; constitution §2). Alternative: literal
   opt-in — default-off until F022 proves precision.
2. **Test-path exemption for `no-direct-process-env`.** Recommendation:
   exempt `*.test.ts`/`*.spec.ts` basenames and path segments `test`,
   `tests`, `__tests__`, `e2e` — env setup in tests (`process.env.NODE_ENV
   = "test"`) is idiomatic and would burn the FP budget on every good
   corpus. Alternative: flag in tests too (max recall, noisy).
3. **`env-without-validation` precision stance.** Recommendation:
   project-scope check as specified — any pinned-lib import anywhere
   silences; hand-rolled `if (!x) throw` validation stays flagged
   (documented FP risk, warn severity, F022 gates). Alternatives:
   per-file granularity (cross-file validation becomes an FP — rejected);
   pinning `@nestjs/config` as a validating import (it does not validate
   without a schema — rejected for now, revisitable).
4. **`no-committed-env` breadth & gitignore approximation.**
   Recommendation: the full 8-name dotenv candidate set, package root
   only, with the approximate matcher (picomatch — no new deps) instead
   of a `git check-ignore` subprocess (environment-dependent, needs a git
   checkout — rejected). Alternative: flag `.env` only (quieter, misses
   `.env.production` class).
5. **New dependencies.** Recommendation: none — picomatch is already a
   runtime dependency (`collect.ts`); everything else is hand-rolled
   pure functions (the boring option).
6. **Category assignments.** Recommendation: `no-direct-process-env` →
   `Configuration`, `env-without-validation` → `Configuration` (mirrors
   `missing-global-validation-pipe`), `no-committed-env` → `Security`
   (credential-leak class, same as `no-hardcoded-secrets`).
