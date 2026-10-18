# Design 030 — Introduced findings

## Module layout

| Module | Responsibility |
|--------|----------------|
| `src/scope/resolve.ts`, `types.ts` | Resolve introduced changed files and the immutable baseline commit. |
| `src/scope/baseline.ts` | Read Git objects into a private temporary tree, pair rename paths, normalize errors, clean up. |
| `src/scope/introduced.ts` | Match occurrence anchors with unchanged-line preference and one-to-one consumption. |
| `src/scope/diff.ts` | Map unchanged current lines to baseline lines from zero-context hunks. |
| `src/engine/parser/types.ts`, `ts-morph-adapter.ts` | Derive normalized diagnostic source anchors behind ParserAdapter. |
| `src/core/scan.ts` | Optionally capture anchors for internal comparison; normal scans retain their result shape. |
| `src/cli/commands/scan.ts`, `run.ts` | Orchestrate baseline comparison before runtime merge; expose the scope. |
| `src/core/report.ts`, reporters/console | Carry introduced mode and visible comparison coverage. |

## Key decisions

1. Add a scope rather than repurposing `changed`. Existing scripts keep their behavior.
2. Read regular Git blobs, never check out a revision or create a Git worktree.
   Materialize source and JSON/framework metadata only; ignore symlinks/submodules
   and default generated/dependency directories. Historical analyzer config is not
   executed. Git is called with argument arrays and diff helpers disabled.
3. Reuse `runScan` with an explicit file subset and the already resolved current
   analyzer configuration. Snapshot context preserves repository-relative layout.
4. Capture source-token anchors through the parser view, keeping compiler access
   inside the adapter. Match rule/message/anchor within paired paths; compare
   occurrences, not sets. IDs remain report identity, not cross-version identity.
5. Prefer unchanged-line correspondence from deterministic Git diffs before matching
   remaining anchors. A moved identical statement can match; copies in new files
   cannot borrow another path's baseline.
6. Keep baseline limitations visible and preserve current candidates when proof is
   unavailable. Do not use a baseline failure as evidence of a clean historical file.
7. Leave runtime merging after static comparison and do not alter CI defaults.

## Dependencies

No new dependencies. Use Node filesystem/temp-directory APIs, existing Git wrapper,
ParserAdapter, and parsed TypeScript syntax inside its adapter.

## Test map

| Acceptance criteria | Verification |
|---------------------|--------------|
| AC-1 | Existing diff-scope/report suites plus introduced CLI regression. |
| AC-2, AC-3, AC-4 | Matcher tests and real Git integration: shifts, mixed old/new, duplicate insertion. |
| AC-5, AC-7 | Git integration: rename, deletion, target filtering, ignores, unsupported sources. |
| AC-6, AC-8 | Git integration/CLI: untracked/new/unborn, default HEAD, merge-base. |
| AC-9 | Integration: current rule overrides and inert historical config. |
| AC-10 | Integration: invalid baseline syntax/config and preserved candidates/coverage. |
| AC-11, AC-16 | CLI: prerequisites, bad refs, flags, error/warning/empty verdicts. |
| AC-12 | CLI/integration coverage assertions. |
| AC-13, AC-14 | CLI double-run equality and current full/introduced ID equality. |
| AC-15 | Snapshot tests: Git status/index/branch, temp cleanup, symlinks, no historical execution. |
| AC-17 | JSONL/pretty tests, console coverage tests, live terminal smoke. |
| AC-18 | Combined-report regression with introduced scope. |
| AC-19, AC-20 | Parser/matcher tests: trivia, movement, substantive edits. |

## Implementation notes

The report remains schema version 1 as with spec 015's additive scope extension.
No comparison statistics or separate baseline report are added to the public JSON.
