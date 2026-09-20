# Tasks 016 — GitHub Action: `ci install`, composite action, PR surfaces

TDD order: leaf modules tests import come first, command wiring last;
close-out is final. Verification before every commit: `pnpm test`,
`pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm format` before committing.

- [x] **T1. Workflow template renderer (AC-3, AC-1 fragments).** RED:
      `tests/unit/ci/workflow-template.test.ts` — required YAML fragments
      (PR trigger types, four permissions, concurrency group +
      `cancel-in-progress`, `fetch-depth: 0`, literal GitHub expressions),
      default ref, `--action-ref` substitution, double-render byte equality.
      GREEN: `src/ci/workflow-template.ts`.
- [x] **T2. PR context resolver (AC-9, AC-10 halves).** RED:
      `tests/unit/ci/context.test.ts` — happy path from env + `--event`
      override, missing event file, unparseable JSON, non-`pull_request`
      event, missing `GITHUB_REPOSITORY`, missing PR fields, API/server URL
      and run-id defaults. GREEN: `src/ci/types.ts`, `src/ci/context.ts`.
- [x] **T3. Surface builders + blocking decision (AC-5..AC-8, AC-14
      builders).** RED: `tests/unit/ci/surfaces.test.ts` — sticky body
      (counts with pluralization, scope/base line, per-file sections, rule
      ids, skippedChecks note, "+N more omitted" cap note, marker last),
      review payloads in report order with `commit_id`/`side`, status
      payload + full (blocking × severities) matrix, disabled-surface
      omission, zero-findings body, path relativization, byte determinism.
      GREEN: `src/ci/surfaces.ts`.
- [x] **T4. REST poster (AC-12, AC-13 unit halves).** RED:
      `tests/unit/ci/poster.test.ts` — POST-when-absent / PATCH-when-marked
      sticky dedup, `Link`-header pagination, missing token ⇒ per-surface
      skips, non-2xx ⇒ named warning + remaining surfaces proceed, review
      abort-on-first-failure, status POST shape. GREEN: `src/ci/poster.ts`.
- [x] **T5. `ci install` command (AC-1..AC-3).** RED: e2e cases in
      `tests/e2e/ci.test.ts` — creates dirs + deterministic file (exit 0,
      stdout path, empty stderr), second run exit 2 leaves file untouched,
      `--force` overwrites, `--action-ref` lands verbatim, two installs in
      fresh dirs are byte-identical. GREEN: `ciInstallCommand` in
      `src/cli/commands/ci.ts`, `ci`/`install` wiring in `src/cli/run.ts`.
- [x] **T6. Composite action (AC-4).** RED: e2e "action.yml declares the
      static contract" — composite `using`, the eight inputs with spec
      defaults, scan step fragments (`--scope lines`, `--format json`,
      report redirect), report step running `ci report`, `GITHUB_TOKEN`
      env. GREEN: `action.yml` at the repository root.
- [x] **T7. `ci report` command — dry-run paths (AC-5..AC-11, AC-14 e2e
      halves).** RED: e2e cases — dry-run envelope parses and matches the
      report (exit 0 under `blocking: none` despite error findings),
      `--blocking error/warn` exit codes + status state, cap via
      `--max-review-comments`, `--no-*` omissions, push event exit 2,
      missing context exit 2, missing/unparseable/schemaVersion-2 report
      exit 2, double dry-run byte equality. GREEN: `ciReportCommand` +
      `ci`/`report` wiring in `src/cli/run.ts`.
- [x] **T8. `ci report` posting path (AC-12 e2e).** RED: e2e cases against
      a local `node:http` server — happy path (empty comment list → POST
      comment, review POSTs, status POST; empty stderr; exit per
      blocking) and all-500 path (three named stderr warnings, exit per
      blocking, no crash). GREEN: poster wiring in `ciReportCommand`.
- [x] **T9. Close-out.** Check boxes, record deviations in this file, spec
      status → Implemented, `docs/PLAN.md` F016 → Done, live CLI smoke
      test of `ci install` and `ci report --dry-run`.

## Deviations & notes

- **T8 landed as characterization, not red→green.** The posting path was
  already wired into `ciReportCommand` when T7 added the command (the
  dry-run and posting paths share the build/post pipeline), so both T8
  e2e tests passed on their first run. They pin the offline network
  behavior (endpoint shapes, fail-soft warnings, blocking verdict) that
  no unit fake covers end-to-end.
- **`spawnSync` deadlock discovered by the first T8 run.** The initial T8
  tests used `runCli` (spawnSync) while serving HTTP from a `node:http`
  server inside the vitest worker: the sync spawn blocks the worker's
  event loop, the server can never answer the child's fetch, and the run
  deadlocks. Fixed by adding `runCliAsync` (promisified `execFile`) to
  `tests/e2e/helpers.ts` and moving the two posting tests to it.
  Durable knowledge recorded in `docs/RESEARCH.md` (CI integration §).
- **Marker import lesson (T4):** the poster test imported `STICKY_MARKER`
  from `poster.js`, which only re-imports it — the binding came through
  as `undefined` under vitest's transform and silently changed what the
  test asserted. The marker stays owned by `surfaces.ts` and tests import
  it from there.
- Minor test-only mistakes caught by the suite before commit: omitted
  `beforeEach/afterEach` import (T2), duplicate fixture filename making
  the "explicit path wins" test self-overwrite (T2), `AddressInfo`
  imported from `node:url` instead of `node:net` (T8). No product code
  affected, no AC changed.
