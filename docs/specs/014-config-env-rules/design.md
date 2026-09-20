# Design 014 — Config & env rules

Decisions and alternatives, so the next agent does not re-litigate. The
spec (approved 2026-09-20) is the scope fence; this file only explains how.

## Module layout

| File | Purpose |
|---|---|
| `src/rules/config/env-usage.ts` | Shared env-access census: finds `process.env.<Ident>` / `process.env["<literal>"]` access nodes in one `SourceFileView`. Used by both env rules. |
| `src/rules/config/config-paths.ts` | Pure path predicates: `isConfigShapedPath`, `isTestShapedPath` (target-relative posix path in, boolean out). |
| `src/rules/config/gitignore.ts` | `isCoveredByGitignore(basename, content)` — approximate gitignore semantics for root-level files (picomatch for glob lines, last-match-wins, `!` negation). |
| `src/rules/config/no-direct-process-env.ts` | File rule (Configuration, warn). |
| `src/rules/config/env-without-validation.ts` | Project rule (Configuration, warn). |
| `src/rules/config/no-committed-env.ts` | Project rule (Security, warn). |
| `src/rules/index.ts` | Registers the three rules (one file rule, two project rules). |
| `src/engine/parser/types.ts` | Type-only re-export grows: `ElementAccessExpression`. |
| `src/engine/runner.ts` | `RuleContext` grows `relativePath: string` (already computed as `relativeFile`); no other engine change. |
| `tests/unit/rules/config-helpers.test.ts` | Pure-function tests for the three helpers. |
| `tests/unit/rules/config.test.ts` | The three rules over fixture trees; fail-soft; config matrix; fixture/doc existence. |
| `tests/e2e/config-rules.test.ts` | Whole-CLI contract on temp trees. |
| `tests/fixtures/config/<rule-id>/{valid,invalid}/` | Fixture trees (project rules get multi-file trees). |
| `docs/rules/backend-doctor/<rule-id>.md` | Three rule docs, house format. |

## Key decisions

1. **`RuleContext` grows `relativePath` (precomputed by the runner).**
   The file rule needs the target-relative path for the config/test-shape
   exemptions. Alternatives rejected: reading `process.cwd()` inside the
   rule (nondeterministic across invocation directories — constitution §1);
   exposing `scanRoot` and calling `file.getRelativePathTo(scanRoot)`
   (one more moving part for the same result — the runner already computes
   `relativeFile`); moving the path exemption engine-side (it is rule
   policy, not engine mechanics). `RuleContext` is engine-internal (not
   exported from `src/index.ts`), so this is not a contract change.
2. **Chain matching anchors at the access whose immediate base is exactly
   `process.env`.** `process.env.FOO.BAR` must yield ONE finding, not two.
   Matching every node whose text starts with `process.env` would
   double-report; matching only full-chain roots via the type checker is
   against the syntax-only engine. Anchoring on "base is the
   `process.env` PropertyAccessExpression" gives exactly one node per
   access chain, at the chain's start (`process`). Whole-env reads
   (`process.env` bare) do not match by construction — that is the
   documented recall hole, not a special case.
3. **Census helper is shared, positions resolved per rule kind.**
   `collectEnvAccesses(view)` returns the access nodes; the file rule
   reports nodes through `ctx.report({ node })`, the project rule through
   `project.positionOf(...)` + line/column. Duplicating the walk in both
   rules was rejected (the `module-api-calls.ts` precedent: shared
   collectors live in the pack).
4. **Project-scope validation check (spec resolution 3).** Any analyzed
   file importing a pinned validation library silences
   `env-without-validation` entirely; the diagnostic is positioned at the
   first access in file-sorted order. Per-file granularity was rejected:
   validation living in a sibling file would flag honest config files.
   The census deliberately does NOT apply the config/test path exemptions
   — reads in config files are exactly the reads that must be validated,
   and a project whose only env reads sit in tests is rare enough to keep
   as a documented FP risk (warn severity, F022 gates).
5. **Gitignore matcher approximates, picomatch reused.** Root-level
   candidates only, so the needed semantics are small: strip comments and
   blanks, trim; `!` negation with last-match-wins; trailing `/` never
   matches a file; leading `/` stripped; glob lines via
   `picomatch(pattern, { dot: true })` (plus a `**/`-prefixed attempt);
   otherwise exact basename equality. A `git check-ignore` subprocess was
   rejected (environment-dependent, needs a git checkout); a full
   gitignore parser is overkill for 8 fixed root-level names. The BOM is
   stripped so a first-line pattern still matches.
6. **The project rule reads the filesystem directly.** `fs.existsSync` /
   `readFileSync` on `packageRoot/.gitignore` and candidates. Rules
   already import `node:path`; the engine itself reads package.json and
   marker files (detect.ts). Growing `ProjectRuleContext` with a file
   surface for one rule was rejected as engine surface without a second
   consumer. Local, deterministic reads only (constitution §1).
7. **Fixture `.env` files are committed with `git add -f`.** The repo
   `.gitignore` ignores `.env` and `.env.*` at every depth, so a plain
   `git add` would silently skip the fixtures and CI would fail on a
   fresh clone. Recorded in RESEARCH.md (T5).
8. **No new dependencies** (spec resolution 5). picomatch is already a
   runtime dependency of the engine.

## Dependencies

None added.

## Test map (AC → test)

| AC | Test |
|---|---|
| AC-1 | `tests/unit/rules/config.test.ts` → `no-direct-process-env`: invalid fixtures give exact diagnostics; valid + `valid-tests` fixtures stay silent. |
| AC-2 | `tests/unit/rules/config.test.ts` → `env-without-validation`: invalid tree gives one diagnostic (position + count in message); `valid-validated` (zod import) and `valid-no-env` trees stay silent. |
| AC-3 | `tests/unit/rules/config.test.ts` → `no-committed-env`: invalid + `invalid-no-gitignore` fixtures give exact diagnostics; valid (gitignore-covered) stays silent. Matcher semantics in `tests/unit/rules/config-helpers.test.ts` (literal, glob, `**/`, directory-only, negation, last-match-wins, BOM). |
| AC-4 | `tests/unit/rules/config.test.ts` → a crashing file rule and a crashing project rule degrade to `internal` diagnostics + skippedChecks while a pack rule's findings survive (mirrors `project-rules.test.ts` precedent). |
| AC-5 | `tests/unit/rules/config.test.ts` → `ignore.rules` and `rules[id]: "off"` silence, `"error"` escalates severity; `tests/e2e/config-rules.test.ts` → escalation flips exit code to 1, pack-off empties the report. |
| AC-6 | `tests/integration/scan.test.ts` → staged tree emits all three rules through `runScan`, two runs identical; `tests/e2e/config-rules.test.ts` → two bin runs byte-identical. |
| AC-7 | `tests/e2e/config-rules.test.ts` → single-file scan target does not crash; `tests/unit/rules/config.test.ts` → packageRoot without `.gitignore`/candidates stays silent (no-gitignore invalid fixture covers the flag side). |
| AC-8 | `tests/unit/rules/config.test.ts` → each rule ships `valid/`+`invalid/` fixtures and its doc file (graph.test.ts precedent); registry count 38 → 41 asserted in `tests/unit/rules/blocking.test.ts`. |
