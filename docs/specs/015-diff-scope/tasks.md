# Tasks 015 — Diff scope

TDD order: pure leaf modules first (types + parser), then the git-backed
resolver, then the core consumption, then the report contract, then CLI
wiring, then the e2e matrix, close-out last.

- [ ] **T1. Scope types + `-U0` hunk parser (AC-3 machinery).** RED:
  `tests/unit/scope/diff-hunks.test.ts` — canonical `@@ -a,b +c,d @@`,
  single-line `@@ -a +c @@`, new-file `@@ -0,0 +1,N @@`, deletion-only hunks
  (`+x,0` → no range), `\ No newline at end of file` tolerance, multiple
  files/hunks in one text. GREEN: `src/scope/types.ts`, `src/scope/diff.ts`.

- [ ] **T2. Git wrapper + `changed`-mode resolution (AC-2, AC-7, AC-10,
  AC-12 machinery).** RED: `tests/unit/scope/git-test-support.ts` (temp repo
  builder, deterministic `-c user.name/-c user.email` commits) +
  `tests/unit/scope/scope-resolver.test.ts` — tracked modified/added sets,
  deleted files excluded, untracked included, gitignored excluded, subdirectory
  target intersects to its subtree, unborn `HEAD` → everything untracked,
  `--base no-such-ref` → error, non-repo target → error, unrelated-histories
  merge-base failure → error. GREEN: `src/scope/git.ts`, `src/scope/resolve.ts`
  (`changed` branch only).

- [ ] **T3. `lines` hunk ranges + `files` set assembly (AC-3, AC-4
  machinery).** RED: extend `tests/unit/scope/scope-resolver.test.ts` —
  tracked file yields per-hunk ranges (edit line 2 of 6 → range around 2),
  tracked file entry exists even when ranges are empty, untracked file has no
  map entry, `files` mode builds the absolute-path set without touching git.
  GREEN: `resolve.ts` (`lines`/`files` branches) + any `git.ts` helper for
  per-file `-U0` diffs.

- [ ] **T4. Core consumption in `runScan` (AC-9; machinery for AC-2/3/10).**
  RED: `tests/integration/scope.test.ts` — hand-built `ResolvedScope` over a
  temp project: collected files intersected; diagnostics restricted to scoped
  files; `lines` filter keeps only in-hunk lines (absent map entry = untracked
  = kept); exactly one `skippedChecks` entry `check:"project-rules"` naming the
  mode and no project-rule diagnostics; `complete:false` vs `true` without
  scope. GREEN: `src/core/scan.ts` (+ `ScanInput.scope`).

- [ ] **T5. Report contract mapping (report halves of AC-1/2/3/4).** RED:
  extend `tests/unit/report.test.ts` — scope absent → `mode:"full"`, no
  `scope` key; `changed`/`lines` → `mode` + `scope:{base}`; `files` → `mode`
  without `scope` key. GREEN: `src/core/types.ts` (`ScanMode`, optional
  `ReportDocument.scope`), `src/core/report.ts`.

- [ ] **T6. CLI flags + validation + wiring (AC-7/8 CLI half).** RED:
  `tests/e2e/diff-scope.test.ts` first slice — `--scope files` without
  `--file`, `--file` without `--scope files`, unknown `--scope` value → exit 2,
  stderr message, empty stdout. GREEN: `src/cli/run.ts` (choices + default,
  `--base`, repeatable `--file`), `src/cli/commands/scan.ts` (combo
  validation, `resolveScope` call, `runScan` scope passthrough).

- [ ] **T7. e2e matrix through the built bin (AC-1..AC-12).** RED:
  complete `tests/e2e/diff-scope.test.ts` on temp git repos — AC-1 default
  unchanged (project-rule diagnostic via `backend-doctor/unused-dependency`
  on a planted package.json); AC-2 changed set; AC-3 in/out-of-hunk +
  untracked; AC-4 files; AC-5 id stability across scopes; AC-6 byte-identical
  double run; AC-7 non-repo / bad base / `PATH:""` (helpers gain `env`); AC-10
  subdirectory target; AC-11 stderr purity + exit 1 on scoped error; AC-12
  unborn `HEAD`. GREEN: whatever the reds expose (expected: none beyond
  helper `env` support in `tests/e2e/helpers.ts`).

- [ ] **T8. Close-out (no TDD).** Check off tasks, record deviations, spec
  status → `Implemented`, `docs/PLAN.md` F015 → `Done`, live CLI smoke test
  with eyeballed output.

## Deviations & notes

- (none yet)
