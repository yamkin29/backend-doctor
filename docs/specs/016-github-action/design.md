# Design 016 — GitHub Action: `ci install`, composite action, PR surfaces

## Module layout

| File | Purpose |
|---|---|
| `src/ci/types.ts` | `BlockingMode`, `PullRequestContext`, `SurfaceOptions`, `ReportSurfaces` envelope, `STICKY_MARKER`, payload shapes. |
| `src/ci/workflow-template.ts` | `DEFAULT_ACTION_REF` + pure `renderWorkflowTemplate(actionRef)` — the byte-deterministic workflow YAML. |
| `src/ci/context.ts` | `resolvePullRequestContext({ eventPath, env })` → `{ ok: true, context }` / `{ ok: false, error }`; pulls event JSON, repository, API/server URLs, run id. |
| `src/ci/surfaces.ts` | Pure builders: `buildSurfaces(doc, opts)` → envelope, `blockingExitCode(doc, mode)` → 0/1. |
| `src/ci/poster.ts` | `postSurfaces(surfaces, deps)` — REST calls via an injected `fetch`, fail-soft per surface, returns stderr warnings. |
| `src/cli/commands/ci.ts` | `ciInstallCommand(opts, cwd)` (sync) and `ciReportCommand(opts, env)` (async). |
| `src/cli/run.ts` | Wires the `ci` command with `install` / `report` subcommands. |
| `action.yml` | Composite action at the repository root (inputs table from the spec). |
| `tests/unit/ci/*.test.ts` | `workflow-template`, `context`, `surfaces`, `poster`. |
| `tests/e2e/ci.test.ts` | AC-1..AC-12, AC-14 against the built bin; AC-4 against `action.yml`. |

## Key decisions

1. **Posting lives in the `ci report` CLI subcommand** (approved OQ-3). The
   alternative — a standalone `.mjs` beside `action.yml` — would duplicate
   `ReportDocument` knowledge untyped and be testable only by string splices.
   The CLI command is typed, unit-testable with an injected `fetch`, and keeps
   the action to ~40 lines of glue. Network calls happen only in this
   integration command, never in the engine (constitution §1).
2. **Dry-run prints one JSON envelope** with the exact payloads
   (`comment` / `reviewComments` / `status`; disabled surfaces omit the key),
   pretty-printed with tabs + trailing newline like the JSON reporter.
   Alternative (delimited text sections) parses worse and buys nothing.
3. **REST client uses the global `fetch` behind a minimal `FetchLike` type.**
   Production passes `fetch`; unit tests pass fakes. e2e cannot inject (it
   spawns the built bin), so its posting tests run a real local `node:http`
   server with `GITHUB_API_URL` pointed at it — fully offline, deterministic.
   No `gh` runtime dependency, no SDK, no new deps (approved).
4. **Sticky-comment dedup via a hidden HTML marker**
   `<!-- backend-doctor:sticky -->`: list existing issue comments
   (`per_page=100`, follow the `Link` header), `PATCH` the one bearing the
   marker, else `POST`. Alternative (match by author) assumes bot identity;
   the marker is the standard robust pattern and immune to renames.
5. **Review comments post individually** (`POST /repos/…/pulls/{n}/comments`
   per payload) and the surface aborts on the first failure with one warning.
   Alternative (one `POST …/reviews` with `comments[]`) is a single call but
   couples us to review-summary body semantics; individual calls fail soft
   cleanly and the cap (50) keeps the call count sane.
6. **The blocking decision is a pure function of (report, mode):**
   `blocking=error` ∧ ≥1 error-severity diagnostic → exit 1;
   `blocking=warn` ∧ ≥1 diagnostic → exit 1; else 0. The commit-status state
   is `failure` ⇔ exit 1, `success` otherwise (so `blocking=none` never
   fails). Same "1 = diagnostics found" discipline as `scan`.
7. **Paths are relativized for GitHub**: review/sticky paths are
   `diagnostic.filePath` relative to `$GITHUB_WORKSPACE` (when set and the
   file is inside it), else relative to the report's `directory`, else
   as-is; separators mapped to posix. The API rejects absolute paths, and
   the action always checks out at the workspace root.
8. **GitHub expressions in the template are escaped** (`\${{`) inside the TS
   template literal so `${{ github.event… }}` renders literally.
9. **No YAML parser anywhere**: the generated workflow is our own fixed
   template (never parsed), and the AC-4 test asserts `action.yml` by stable
   string fragments. Adding a parser dependency for one assertion fails the
   no-new-deps goal.
10. **`ci install` is cwd-injectable** (`ciInstallCommand(opts, cwd)`, the
    `initCommand` precedent) so e2e can run it in temp dirs; it refuses to
    overwrite an existing workflow (exit 2, init precedent) unless `--force`.
11. **`ci report` validates `schemaVersion === 1`** before building surfaces —
    a future report v2 read by an old action fails loud instead of
    misposting (constitution §5: consumers branch on the version).

## Dependencies

None new (approved). Global `fetch` needs Node ≥20; `package.json` engines
already require `>=20`. The `ci` command name is the constitution §10
reservation.

## Test map (AC → test)

| AC | Test |
|---|---|
| AC-1 | `tests/e2e/ci.test.ts` — "ci install creates the workflow"; unit `workflow-template` fragments |
| AC-2 | e2e — "refuses to overwrite an existing workflow" / "--force overwrites" |
| AC-3 | unit `workflow-template` — ref substitution; e2e — `--action-ref` lands in the file |
| AC-4 | e2e — "action.yml declares the static contract" |
| AC-5 | unit `surfaces` — envelope shape (counts, per-file, marker, side RIGHT); e2e — dry-run JSON parses and validates |
| AC-6 | unit `surfaces` — full (blocking × severities) matrix; e2e — `--blocking error/warn` exit codes |
| AC-7 | unit `surfaces` — cap and "+N more omitted" note; e2e — `--max-review-comments 2` on a 3-finding report |
| AC-8 | unit `surfaces` + e2e — `--no-comment/--no-review-comments/--no-commit-status` omit envelope keys |
| AC-9 | unit `context` — push event rejected; e2e — exit 2, event named on stderr |
| AC-10 | unit `context` + e2e — missing event file / `GITHUB_REPOSITORY` / report path |
| AC-11 | e2e — missing, unparseable, and `schemaVersion: 2` report files |
| AC-12 | unit `poster` — failure ⇒ warning + other surfaces proceed; e2e — local 500-server: three named warnings, blocking exit honored |
| AC-13 | unit `poster` — PATCH on marked comment, POST otherwise, `Link` pagination walk |
| AC-14 | unit `surfaces` + e2e — double dry-run byte equality |
