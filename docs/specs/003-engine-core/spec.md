# Spec 003 — Engine core (F003)

- **Status:** Implemented (2026-09-19)
- **Phase:** 0 — Foundation
- **Depends on:** F001 (CLI), F002 (Config) — both Done
- **Blocks:** F004 (framework detection), F005+ (rule packs)

## Problem

The scan pipeline is a stub: it accepts `ScanInput` (directory, ignore globs,
resolved config) and returns zero diagnostics. Nothing is parsed and no rules run.
F003 builds the engine — file collection, parsing behind a `ParserAdapter`, a rule
registry and runner with crash isolation, deterministic diagnostic ids, severity
resolution from the config — and connects it to `runScan`, so the existing reporters
and exit codes start carrying real diagnostics.

## Goals

- Recursive file collection under the scan target with default excludes and
  config/CLI ignore globs finally enforced.
- Parsing via ts-morph hidden behind a `ParserAdapter` interface in one module.
- `RuleRegistry` + `RuleRunner`: rules are self-contained definitions with id,
  category, default severity and a `create(ctx)` body.
- Crash isolation per rule per file (constitution §8): a throwing rule becomes an
  `internal` diagnostic + a `skippedChecks` entry; the scan continues.
- Severity resolution: `config.rules[id]` > `config.categories[category]` > rule
  default; `off` and `ignore.rules` disable.
- Deterministic diagnostics (constitution §1): stable ids, fixed output ordering.
- `projects[]` block filled (packageRoot, analyzedFiles, counts, skippedChecks).
- Two seed rules to prove the pipeline end to end: `no-eval`, `no-new-func`
  (proposed — see open questions).

## Non-goals

- Type-aware rules (no `Program`/typechecker yet — the adapter grows when the first
  type-aware rule lands; tsconfig is not used for file selection in F003).
- Framework detection (F004) — `projects[].frameworks` stays `[]`.
- Nest/Prisma rules (Phases 1–2).
- Parallel scanning, caching, watch mode.

## User stories

1. As a backend developer, I run `backend-doctor scan .` in a project with an
   `eval()` in the code and see `src/legacy.ts:12:3  warn  backend-doctor/no-eval …`
   in the terminal.
2. As a CI author, I set `rules: { "backend-doctor/no-eval": "error" }` in the config
   and the scan exits 1 while that violation exists.
3. As an AI agent, I read `--format jsonl` diagnostics line by line, with stable ids
   I can reference across runs.

## Engine contract

### File collection (AC-1, AC-2)

- Extensions: `.ts`, `.tsx`, `.mts`, `.cts`.
- Default excludes: `node_modules/**`, `dist/**`, `build/**`, `coverage/**`,
  `.git/**` — plus `ignore` globs from `ScanInput` (config `ignore.files` ∪ CLI
  `--ignore`), matched with picomatch (`dot: true`) against paths relative to the
  scan target.
- Unreadable/unparseable files do not fail the scan: they produce a
  `projects[].skippedChecks` entry `{ check, reason }` (constitution §8).

### Rules and diagnostics (AC-3, AC-4)

- Rule definition: `{ id: "backend-doctor/<name>", title, category, severity
  (default), docs, create(ctx) }`. `create` traverses the adapter's AST and calls
  `ctx.report({ node | line/column, message })`.
- Diagnostic: 1-based `line`/`column`, `category`, resolved `severity`, `message`,
  `tags` and a deterministic id:
  `<relativeFile>::<line>:<col>::<rule>::<8-char sha256 of file:line:col:rule:message>`.
- Output ordering: diagnostics sorted by (relativeFile, line, column, rule id).

### Severity resolution & disabling (AC-5)

`config.rules[id]` wins over `config.categories[category]`, which wins over the
rule's default severity. `"off"` (or the id listed in `ignore.rules`) disables the
rule entirely.

### Crash isolation (AC-6)

A rule throwing during `create` or traversal: scan continues; the finding is
reported as a diagnostic tagged `internal` (severity `warn`, message names the rule
and the error) plus a `skippedChecks` entry. It does not silently disappear.

### Output (AC-7, AC-8)

- Reporters (pretty/json/jsonl from F001) render real diagnostics unchanged.
- Exit code 1 iff at least one error-severity diagnostic (existing policy).
- `projects[]`: `{ packageRoot, frameworks: [], analyzedFiles (relative, sorted),
  analyzedFileCount, complete: true, skippedChecks }`.

### Determinism (AC-10)

Same tree + same config → byte-identical JSON report.

## EARS acceptance criteria

- **AC-1:** WHEN a scan starts, THE SYSTEM SHALL collect `.ts/.tsx/.mts/.cts` files
  recursively under the scan target, excluding default excludes and ignore globs.
- **AC-2:** WHEN a file cannot be read or parsed, THE SYSTEM SHALL add a
  `skippedChecks` entry and continue the scan.
- **AC-3:** WHEN rules report findings, THE SYSTEM SHALL emit diagnostics with
  1-based positions, category, resolved severity, message and tags.
- **AC-4:** WHEN the same file is scanned twice, THE SYSTEM SHALL produce identical
  diagnostic ids (hash of file, position, rule, message).
- **AC-5:** WHEN resolving severity, THE SYSTEM SHALL apply `config.rules[id]` over
  `config.categories[category]` over the rule default, and disable the rule when
  severity resolves to `off` or the id is in `ignore.rules`.
- **AC-6:** WHEN a rule throws, THE SYSTEM SHALL continue scanning and emit an
  `internal` diagnostic plus a `skippedChecks` entry.
- **AC-7:** WHEN diagnostics exist, THE SYSTEM SHALL render them in all three
  formats and exit 1 iff at least one has error severity.
- **AC-8:** WHEN a scan completes, THE SYSTEM SHALL fill `projects[]` with
  packageRoot, analyzedFiles (relative, sorted), analyzedFileCount, complete and
  skippedChecks.
- **AC-9:** WHEN the registry contains rules, THE SYSTEM SHALL run only enabled
  ones (registered, severity ≠ off, not ignore-listed).
- **AC-10:** WHEN the same tree is scanned twice with the same config, THE SYSTEM
  SHALL produce byte-identical JSON reports.

## Seed rules (proposed)

`backend-doctor/no-eval` and `backend-doctor/no-new-func` (Security, default
`warn`): flag `eval(...)`, `new Function(...)`, and indirect forms
`(0, eval)(...)`. Low false-positive risk, trivially testable, and they make the
engine observable without waiting for Phase 1. Each ships with valid/invalid
fixtures, snapshot tests and `docs/rules/<id>.md` (constitution §3).

## Testing strategy (TDD)

- Unit: file collection on temp trees (extensions, excludes, dotfiles, ignore
  globs); severity resolution matrix; diagnostic id stability; crash isolation with
  a deliberately throwing fixture rule; seed rules against fixtures.
- Integration: `runScan` on a fixture project (bad-app) with a known violation set.
- e2e: bin against the fixture project — pretty contains relative path + rule id;
  json `diagnostics[]` + `projects[]` shape; jsonl non-empty; severity override via
  config (`no-eval: error` → exit 1); two consecutive runs byte-identical.

## Open questions for review

1. **Seed rules in F003** (`no-eval`, `no-new-func`) — recommended yes; the engine
   without any real rule is only provable through test fixtures. Alternative: zero
   product rules until F005.
2. **Constitution §4 interpretation** — proposed wording: parser specifics live in
   `src/engine/parser/`; rules import only adapter-exported types (no direct
   ts-morph imports elsewhere). This keeps a hard module boundary while admitting
   that an oxc-parser migration (Engine v2) will rewrite rule *internals*.
   Constitution changes need your explicit approval (constitution header).
3. **tsconfig is not used for file selection** in F003 (our own globber decides
   what is scanned); type-aware usage comes later with the first type-aware rule.
4. **`analyzedFiles` in the JSON report** — full relative list (may be large on big
   repos). Recommended for MVP; can cap or move behind a flag later.
5. **New dependency:** `ts-morph` (latest major; pinned after install).

## Resolution (recorded at implementation, 2026-09-19)

All recommended options were adopted: (1) seed rules shipped; (2) §4 enforced as a
module boundary — only `src/engine/parser/ts-morph-adapter.ts` imports ts-morph at
runtime, `parser/types.ts` is the sole re-export surface (no constitution text
change); (3) no tsconfig in file selection; (4) `analyzedFiles` uncapped; (5)
`ts-morph@28` pinned. Implementation deviations from the design sketch are listed
in [tasks.md](./tasks.md).
