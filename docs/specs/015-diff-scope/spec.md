# Spec 015 — Diff scope: `--scope changed|files|lines` (F015)

- **Status:** Implemented (2026-09-20)
- **Phase:** 4 — Integrations
- **Depends on:** F001 CLI skeleton (Done), F002 Config (Done), F003 Engine core (Done), F013 project rules (Done)
- **Blocks:** F016 GitHub Action (inline review comments consume `--scope lines`), F017 Agent integration (SKILL.md says "run after edits, scope changed")

## Problem

A full scan answers "what is wrong with the whole project"; it is the wrong tool
for two Phase-4 consumers. An AI agent that just edited three files (F017) needs
findings for what it touched, not a project-wide wall of pre-existing findings. A
PR integration (F016) needs findings attributable to the lines the PR changed so
they can become inline review comments. Both need a scoped scan whose output
stays deterministic and whose diagnostic ids match the ids the same finding gets
in a full scan. Today the CLI always scans everything (`mode: "full"` is the only
scan mode) and there is no way to restrict the analyzed set.

## Goals

- G1. `backend-doctor scan` gains `--scope <mode>` with choices `all` (default,
  today's behavior) `| changed | files | lines` — the PLAN line's flag.
- G2. `--base <ref>` selects the git ref the diff is computed against
  (merge-base of `<ref>` and `HEAD`); default `HEAD`, which makes `changed`
  mean "uncommitted work": modified/staged tracked files plus untracked
  non-ignored files.
- G3. `--file <path>` (repeatable) supplies the explicit file list for
  `--scope files`.
- G4. The changed set is computed from local git only (`merge-base`, `diff`,
  `ls-files --others`): deleted files are never analyzed; untracked
  non-ignored files count as changed; an unborn `HEAD` degenerates to "every
  collected file is changed" (nothing is tracked yet, everything is new).
- G5. Degradation is visible, never silent (constitution §8): scoped reports
  carry `mode` = the scope, `projects[].complete: false`, and one
  `skippedChecks` entry (`check: "project-rules"`) explaining that project
  rules need the full file set.
- G6. Diagnostic ids are scope-independent: the same finding (same
  file/line/column/rule/message) has the same id in `all`, `changed` and
  `lines` runs; output stays byte-deterministic for identical repo state
  (constitution §1, §5).
- G7. No new dependencies: git is invoked via `node:child_process`
  (`execFile`, no shell); the unified-diff hunk parser is written in-repo.

## Non-goals

- **Config fields `scope`/`base`** (react-doctor parity) — not in this feature;
  CLI flags only. Can be added additively later if F016/F017 need them
  (Open question 5).
- **GitHub Action, PR comments, commit status** — F016 consumes `--scope lines`
  but builds none of its plumbing here.
- **SKILL.md / agent workflow** — F017.
- **Runtime scope modes** — Phase 5 probe features own runtime; `mode` stays a
  static-scan field for now (see Open question 1).
- **Smart scoping of project rules** (running graph rules on a diff-aware
  subgraph, or full-tree analysis with post-filtering) — project rules are
  skipped in partial scopes (Open question 2); a smarter design would need its
  own spec.
- **Rename/copy detection semantics** — a renamed file contributes its resulting
  path (the old path is "deleted" and skipped); no rename-aware attribution.
- **Files outside the scan target** — the scope set is intersected with the
  collected set, so `--scope changed` on a subdirectory target ignores changes
  elsewhere in the repo; repo-wide scoping is out of scope.

## User stories

1. **Backend developer** — after editing `users.service.ts`, runs
   `backend-doctor scan --scope changed` and sees only findings in the files
   she touched, with the same messages and ids a full scan would give.
2. **CI author** — on a PR, runs
   `backend-doctor scan --scope lines --base origin/main --format json`;
   the job exits 1 only for error-severity findings on changed lines, the
   report says `mode: "lines"` / `complete: false`, and deterministic ids let
   the comment bot deduplicate across pushes.
3. **AI agent** — after edits, runs `--scope changed` (or `--scope lines`);
   ids are stable across its runs, `skippedChecks` tells it plainly that
   project-level rules did not run, and jsonl output stays one diagnostic per
   line.

## Contract / Model

### CLI surface (additive; existing flags untouched)

```
backend-doctor scan [path]
  --scope <mode>   all (default) | changed | files | lines
  --base <ref>     git ref for changed/lines; default "HEAD"
  --file <path>    repeatable; the explicit file set for --scope files
```

- `[path]` semantics unchanged (directory or file; default cwd).
- Flag validation (usage errors, exit 2, message on stderr, nothing on stdout):
  - `--scope files` with no `--file`;
  - `--file` without `--scope files`;
  - `--scope changed|lines` when the target is not inside a git work tree,
    git is not executable, or `--base` does not resolve;
  - unknown `--scope` value (commander choices, as `--format` today).
- `--dump-config`, `--config`, `--ignore`, `--format` behave exactly as today;
  scope/base/file are **not** config fields in this feature.

### Scope semantics

- `all` — today's pipeline, untouched: mode `"full"`, project rules run,
  `complete: true`.
- `changed` — analyzed set = collected files ∩ changed set, where the changed
  set is: `git diff --name-only --diff-filter=d $(git merge-base <base> HEAD)`
  (tracked files modified/staged/committed since the merge-base, deleted files
  excluded) ∪ `git ls-files --others --exclude-standard` (untracked,
  gitignored files excluded). All git commands run with cwd = the work-tree
  toplevel (`git rev-parse --show-toplevel`); paths are toplevel-relative and
  mapped back to absolute before intersecting with the collected set, so
  subdirectory targets keep only changes under the target.
- `files` — analyzed set = collected files ∩ the `--file` paths (resolved
  against the process cwd).
- `lines` — analyzed set as in `changed`, then diagnostics are filtered: a
  diagnostic survives iff its line falls inside a changed hunk of
  `git diff -U0 <merge-base>` for its file. Untracked files have no diff
  hunk → every line counts as changed. An untracked file in `changed` scope
  is analyzed whole.
- Unborn `HEAD` (fresh repo): the merge-base step contributes nothing
  (nothing tracked) and the untracked step yields all collected files —
  `changed`/`lines` then cover the whole tree with project rules still skipped.

### Report deltas (all other fields byte-identical)

- `mode`: `"full" | "changed" | "files" | "lines"` — `"full"` remains the value
  for the default scope (no rename; existing consumers keep working).
- `projects[].complete`: `false` when scope ≠ `all`.
- `projects[].analyzedFiles` / `analyzedFileCount`: the scoped set.
- `projects[].skippedChecks`: gains one entry
  `{ check: "project-rules", reason: "skipped: <mode> scope analyzes a file subset; project rules require the full file set" }`
  when scope ≠ `all`.
- Proposed additive optional field (Open question 1): report-level
  `scope?: { base: string }` — present only for `changed`/`lines`, carrying the
  resolved `--base` value for reproducibility.
- `schemaVersion` stays `1` (additive change; announcement in release notes).
- Exit codes unchanged: `0` clean / `1` any error-severity diagnostic in the
  scoped output / `2` usage-environment errors listed above. stdout carries the
  report; stderr stays empty on success paths.

## EARS acceptance criteria

- **AC-1.** WHEN a scan runs without `--scope` THE SYSTEM SHALL behave exactly
  as before this feature: `mode` `"full"`, `complete` `true`, project-rule
  diagnostics present (e.g. `unused-export` fires on a fixture with a dead
  export), and no `project-rules` skippedChecks entry.
- **AC-2.** WHEN `--scope changed` runs in a repo where the merge-base diff and
  untracked set name files F (and no others) THE SYSTEM SHALL restrict
  diagnostics and `analyzedFiles` to F, set `mode` `"changed"`, and set
  `complete` `false`.
- **AC-3.** WHEN `--scope lines` runs and a changed file has diagnostics both
  inside and outside the changed `-U0` hunks THE SYSTEM SHALL keep only the
  in-hunk diagnostics; WHEN the file is untracked THE SYSTEM SHALL keep all of
  its diagnostics; `mode` SHALL be `"lines"`.
- **AC-4.** WHEN `--scope files --file a.ts --file b.ts` runs THE SYSTEM SHALL
  restrict diagnostics and `analyzedFiles` to the collected files matching
  those paths, and set `mode` `"files"`.
- **AC-5.** WHEN the same finding (same file, line, column, rule, message) is
  reported by an `all` run and by a `changed`/`lines` run THE SYSTEM SHALL
  report the identical diagnostic `id` in both.
- **AC-6.** WHEN two scans with identical flags run against an unchanged repo
  state THE SYSTEM SHALL produce byte-identical stdout.
- **AC-7.** WHEN `--scope changed|lines` is used outside a git work tree, or
  git is not executable, or `--base` does not resolve THE SYSTEM SHALL exit 2,
  write a reason naming the problem to stderr, and write nothing to stdout.
- **AC-8.** WHEN `--scope files` is given without `--file`, or `--file` without
  `--scope files` THE SYSTEM SHALL exit 2 with a usage message on stderr and
  write nothing to stdout.
- **AC-9.** WHEN scope ≠ `all` THE SYSTEM SHALL run no project rules and add
  exactly one `skippedChecks` entry with `check` `"project-rules"` whose
  reason names the active scope.
- **AC-10.** WHEN the scan target is a subdirectory of the repo and
  `--scope changed` is used THE SYSTEM SHALL omit findings for changed files
  outside the target.
- **AC-11.** WHEN scope flags are valid THE SYSTEM SHALL write the report to
  stdout and nothing to stderr, with the existing exit-code policy (0/1) —
  including exit 1 when a scoped run finds an error-severity diagnostic.
- **AC-12.** WHEN `HEAD` is unborn and `--scope changed` runs THE SYSTEM SHALL
  treat every collected file as changed (mode `"changed"`, all files analyzed).

## Testing strategy (TDD)

- **Unit — `tests/unit/scope/`**
  - `diff-hunks.test.ts` — the `-U0` hunk parser: canonical `@@ -a,b +c,d @@`,
    single-line `@@ -a +c @@` form, `@@ -0,0 +1,N @@` (new file), zero-count
    new-side ranges, tolerance of `\ No newline at end of file` markers.
    Pure-function tests, no fixtures.
  - `scope-resolver.test.ts` — the changed-set/line-range resolution against
    real temp git repos created by a small helper (`git init`, `-c user.name`,
    `-c user.email` for determinism; commits via `execFile`): modified, added,
    deleted, renamed, untracked, gitignored, subdirectory targets, unborn
    `HEAD`, unresolvable `--base`, non-repo directory. No committed fixtures —
    everything is generated in `os.tmpdir()`.
- **e2e — `tests/e2e/diff-scope.test.ts`** (built bin via `runCli`, temp git
  repos): AC-1..AC-12 mapped one-to-one; JSON assertions on `mode`/`complete`/
  `skippedChecks`/`analyzedFiles`; byte-equality double run for AC-6; id
  equality across scopes for AC-5; stderr purity per AC-7/8/11.
- No `tests/fixtures/` additions; existing suites must stay green unchanged
  (AC-1 regression net).

## Open questions for review

All five were resolved on approval (2026-09-20) by adopting the
recommendations: (1) report contract grows as specified, `schemaVersion` stays
`1`; (2) project rules are skipped with a visible `skippedChecks` entry in
partial scopes; (3) `--base` defaults to `HEAD`; (4) `--scope files` takes
repeatable `--file <path>`; (5) config fields `scope`/`base` are out of F015 —
CLI-only.

1. **Report contract growth.** Widen `mode` to
   `"full" | "changed" | "files" | "lines"`, flip `complete` to `false` on
   partial scopes, and add the optional report-level `scope: { base }` field;
   `schemaVersion` stays `1`. All additive, but `mode` is a consumer-visible
   enum. **Recommendation: approve as specified** — react-doctor's report has
   the same `mode` field, our consumers branch on `schemaVersion`, and without
   `scope.base` a CI report cannot be reproduced.
2. **Project rules in partial scopes.** (a) Skip with a visible
   `skippedChecks` entry — recommended: graph semantics (`unused-export`,
   `unused-file`, `circular-dependency`) over a subset manufacture false
   positives, violating constitution §2; full-tree analysis defeats the point
   of a cheap scoped run. (b) Run them on the subset. (c) Always analyze the
   full tree and filter afterwards. **Recommendation: (a).**
3. **`--base` default.** (a) `HEAD` — recommended: makes `--scope changed`
   mean "my uncommitted work", exactly the agent flow F017 encodes; CI passes
   `--base origin/main` explicitly, and merge-base handles any ref. (b) Require
   it explicitly (friction for the primary local use case). (c) Default
   `main`/`origin/HEAD` (fails on fresh repos, guesses branch names).
   **Recommendation: (a).**
4. **`--scope files` input mechanism.** (a) Repeatable `--file <path>` —
   recommended: additive to the parser, explicit, shell-friendly
   (`--file $(git diff --name-only …)` word-splitting aside, xargs/arrays
   work). (b) Read paths from stdin (breaks `--format jsonl`'s stdout contract
   separation? no — but stdin plumbing is less boring and hard to test
   uniformly). (c) Variadic positional `[paths...]` (changes the existing
   `[path]` argument contract). **Recommendation: (a).**
5. **Config fields `scope`/`base` now or never.** react-doctor carries both in
   config; our F002 deliberately adopted a subset without them. Adding them now
   is easy but expands the F015 surface beyond the PLAN line
   (`--scope changed|files|lines`), and unknown top-level config keys are
   silently ignored today, so nothing breaks by waiting. **Recommendation:
   CLI-only in F015; revisit if F016/F017 want repo-pinned defaults.**
