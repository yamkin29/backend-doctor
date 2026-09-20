# Design 015 — Diff scope

## Module layout

| File | Purpose |
|------|---------|
| `src/scope/types.ts` | `ScopeMode` (`"changed" \| "files" \| "lines"`), `ScopeOption` (`"all" \| ScopeMode`), `LineRange` (`{ start, end }`, 1-based inclusive), `ResolvedScope` (`{ mode, files: ReadonlySet<string> (absolute), lineRanges: ReadonlyMap<string, readonly LineRange[]>, base? }`). |
| `src/scope/git.ts` | The only place that spawns git. `execFile("git", …)` with `cwd` + `maxBuffer: 16 MiB`; `runGit(cwd, …args)` returns the trimmed stdout or a failing `{ error }`; helpers `gitToplevel`, `gitRefResolves`, `gitMergeBase`, `gitChangedFiles`, `gitUntrackedFiles`, `gitHunksForFile`. Never a shell. |
| `src/scope/diff.ts` | Pure `parseHunks(diffText): LineRange[]` — scans lines for `@@ -a[,b] +c[,d] @@` and maps the new-side start/count to inclusive ranges; count 0 (pure deletion) contributes nothing. |
| `src/scope/resolve.ts` | `resolveScope({ target, mode, base, files }): Promise<ScopeResolution>` — the flag semantics of spec 015 (§Scope semantics) as a pure-ish function over git: `files` mode is synchronous set-building; `changed`/`lines` run the git pipeline and return `{ ok: true, scope }` or `{ ok: false, error }` (message goes to stderr, exit 2 by the CLI). |
| `src/core/types.ts` | `ScanMode` widens to `"full" \| ScopeMode`; `ReportDocument` gains optional `scope: { base: string }`. |
| `src/core/scan.ts` | `ScanInput` gains optional `scope?: ResolvedScope`. Pipeline changes: collected files are intersected with `scope.files`; project rules run only when scope is absent, otherwise one `skippedChecks` entry; `lines` filters diagnostics to changed hunks after the per-file loop; `projects[].complete` mirrors the scope. |
| `src/core/report.ts` | `mode` = scope mode or `"full"`; `scope: { base }` only for `changed`/`lines`. |
| `src/cli/commands/scan.ts` | Flag validation (`--file` combos), scope resolution call, `runScan({ …, scope })`. |
| `src/cli/run.ts` | `--scope <mode>` (commander `choices`, default `"all"`), `--base <ref>`, repeatable `--file <path>`. |
| `tests/e2e/helpers.ts` | `runCli` gains an optional `env` merge (for the git-not-executable e2e case). |
| `tests/unit/scope/git-test-support.ts` | Temp-repo builder: `git init` + deterministic commits (`-c user.name/-c user.email`), `writeAndCommit`, `dirty` helpers; everything under `os.tmpdir()`. |

## Key decisions

1. **Scope resolution is a CLI-side pre-step; `runScan` consumes a resolved
   `ResolvedScope` (absolute file set + optional line ranges).** Alternative —
   git calls inside `runScan`: rejected because "not a git repo / bad base" are
   usage-environment errors (exit 2) that the CLI layer owns, and because
   `runScan` integration tests would then need git repos; core stays
   git-free with fully explicit inputs (constitution §1 spirit: same inputs →
   same output).
2. **All git commands run with cwd = work-tree toplevel** (`rev-parse
   --show-toplevel`), paths mapped back via `join(toplevel, rel)`. Verified
   empirically (spec draft probe): `diff --name-only` is toplevel-relative from
   any cwd while `ls-files --others` is cwd-relative; normalizing on toplevel
   makes both consistent and subdirectory targets fall out as a plain
   intersection (AC-10). Alternative — parsing `../`-prefixed cwd-relative
   output: brittle, rejected.
3. **Per-file `-U0` diffs for hunk ranges** (`git diff -U0 <mergeBase> --
   <path>`, one `execFile` per tracked changed file) instead of one whole-tree
   patch. Rejected the whole-tree patch: file switching would have to be
   parsed from `---/+++` headers, which are ambiguous for spaces in paths and
   affected by `diff.noprefix`-style config; per-file calls only need the
   `@@` headers, which carry pure numbers. N local git invocations is
   acceptable for a scoped run.
4. **Determinism/safety flags on every git diff: `--no-color --no-ext-diff
   --no-textconv`, `-z` for name output, `--diff-filter=d`.** `--ext-diff`/
   textconv would execute user-configured helper programs — both
   non-deterministic and an execution surprise; `-z` removes path quoting
   (`core.quotePath`) from the one path-bearing output we read.
5. **Rules always see whole files; scope filters inputs (file set) and outputs
   (line filter).** Alternative — feeding rules only hunk-truncated sources:
   rejected, it breaks AST rules, positions, and the id-stability contract
   (AC-5): the same finding must hash the same in every scope.
6. **Line-range membership semantics:** `lineRanges` has an entry for every
   tracked changed file (possibly empty = no changed lines → all diagnostics
   filtered) and **no entry** for untracked files (= whole file changed →
   diagnostics kept). In `changed`/`files` modes the map is empty and unused.
7. **Unborn `HEAD` decision table** (in `resolveScope`, in order): (a)
   `rev-parse --verify -q <base>` fails → if `base === "HEAD"` treat the repo
   as unborn (tracked diff skipped; changed = untracked only), else error;
   (b) `HEAD` itself unborn → same unborn mode regardless of a valid explicit
   base (there is no history to merge against); (c) `merge-base` failing with
   both refs alive (unrelated histories) → error. Satisfies AC-12 and AC-7
   without special-casing the default.
8. **`--base` is silently unused for `scope=all|files`; `--file` paths that
   match nothing yield an empty report, not an error.** Both follow from the
   spec contract (intersection semantics, flag table) and stay unlisted-error
   free; a stricter UX would expand the contract beyond the spec.
9. **`mode` mapping in one place** — `buildReport`: `scope ? scope.mode :
   "full"`. Without `--scope`, `ScanInput.scope` is `undefined` and every code
   path is the pre-F015 one (AC-1 by construction; the `scope` report key is
   simply absent for `full`/`files`).
10. **Crashed-rule diagnostics obey the line filter like any other finding**
    (they carry `line: 1` of their file). Uniform rule, no exceptions to
    document; a crash inside an unchanged line region of `lines` scope stays
    visible in `skippedChecks` even when its diagnostic is filtered.

## Dependencies

None added (spec G7). `node:child_process.execFile` + `node:path`; git itself
is a user-environment binary, and its absence is a reported usage error
(AC-7), not a dependency.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/e2e/diff-scope.test.ts` — default scan: JSON `mode:"full"`, `complete:true`, no `project-rules` skippedChecks entry, and a project-rule diagnostic (`backend-doctor/unused-dependency` on a planted package.json) proves the pass ran. |
| AC-2 | e2e: base commit with two bad files; edit one, add an untracked one, touch an ignored one → `--scope changed --format json`: diagnostics + `analyzedFiles` == {edited, untracked}, `mode:"changed"`, `complete:false`. Unit: `tests/unit/scope/scope-resolver.test.ts` (modified/added/deleted/untracked/ignored sets). |
| AC-3 | e2e: tracked file with issues inside and outside the edited hunk → only inside kept; untracked file → all kept; `mode:"lines"`. Unit: `tests/unit/scope/diff-hunks.test.ts` + resolver hunk ranges. |
| AC-4 | e2e: `--scope files --file a.ts --file b.ts` → diagnostics/analyzedFiles restricted, `mode:"files"`. |
| AC-5 | e2e: full vs `changed` vs `lines` runs report the identical diagnostic id for the same finding. |
| AC-6 | e2e: two identical `--scope lines --format json` runs → byte-identical stdout. |
| AC-7 | e2e: non-git dir; `--base no-such-ref`; `runCli` with `PATH:""` (git missing) → all exit 2, stderr names the cause, stdout empty. Unit: resolver error branches (non-repo, bad base). |
| AC-8 | e2e: `--scope files` without `--file`; `--file x` without `--scope files` → exit 2, stderr messages, stdout empty. |
| AC-9 | `tests/integration/scope.test.ts` (runScan with a hand-built scope): exactly one skippedChecks entry `check:"project-rules"`, reason names the mode; e2e JSON assertion backs it. |
| AC-10 | e2e: change files inside and outside a subdirectory target → only the inside one reported. |
| AC-11 | e2e: success runs have empty stderr (existing `expectSuccess`); scoped run with an error-severity finding exits 1. |
| AC-12 | e2e: `git init` with no commits → `--scope changed` analyzes every collected file (`mode:"changed"`). |

Pure-unit backfill for the parser and resolver lives in
`tests/unit/scope/` and is intentionally separate from the e2e matrix so the
git plumbing can be reasoned about without spawning the bin.
