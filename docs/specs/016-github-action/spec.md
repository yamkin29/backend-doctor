# Spec 016 — GitHub Action: `ci install`, composite action, PR surfaces (F016)

- **Status:** Draft — pending review
- **Phase:** 4 — Integrations
- **Depends on:** F001 CLI skeleton (Done), F002 Config (Done), F003 Engine core + reporters (Done), F015 Diff scope (Done — `--scope lines` + merge-base `--base` exist for exactly this consumer)
- **Blocks:** — (the action's default `npm install` path *activates* at F023 npm publish, but nothing consumes F016)

## Problem

backend-doctor findings today die in the developer's terminal. A PR integration is
the cheapest way to put them in front of a team: findings on changed lines become
review comments, a sticky comment carries the summary, and a commit status feeds
branch protection. F015 built the exact substrate this needs — `--scope lines
--base <ref>` produces line-precise, deterministically-identified diagnostics for
what a PR changed. What is missing is everything around it: a generated workflow
(`ci install`), a composite action that runs the scan and posts the results, and
an advisory-by-default failure policy (`blocking: none`) so adoption never turns
someone's main branch red. This is the PLAN's F016 line and the react-doctor CI
precedent we already adopted in spirit (RESEARCH.md, CI row).

## Goals

- G1. New CLI command `backend-doctor ci install` (the constitution-reserved `ci`
  command, constitution §10) that writes `.github/workflows/backend-doctor.yml`
  into the target repository — a minimal PR-triggered workflow using our
  composite action.
- G2. A composite action `action.yml` at this repository's root with inputs:
  `blocking`, `base`, `directory`, `comment`, `review-comments`,
  `commit-status`, `review-comments-max`, `version`. It installs the CLI, runs
  `scan --scope lines --format json` against the PR merge-base, and posts the
  results.
- G3. PR surfaces, per the PLAN line: one **sticky PR comment** (created or
  updated, never stacked), **inline review comments** on the changed lines that
  have diagnostics (capped, default 50), and a **commit status** on the PR head
  SHA.
- G4. Advisory by default: `blocking: none` never fails the job and always
  reports `success`; `blocking: error` fails on ≥1 error-severity finding;
  `blocking: warn` fails on ≥1 finding of any severity (react-doctor precedent).
- G5. Every surface is fail-soft and loud (constitution §8): a posting failure
  (fork PR with no write token, API error) skips that surface with a named
  stderr warning and never masks the blocking decision.
- G6. Deterministic payload construction (constitution §1): comment bodies,
  review payloads, status descriptions and `--dry-run` output are pure functions
  of (report, event, inputs) — byte-identical for identical input, no
  timestamps in bodies.
- G7. No new dependencies: GitHub REST calls use the Node global `fetch`
  (Node ≥20, package.json `engines`); no YAML parser, no GitHub SDK, no `gh`
  runtime dependency.

## Non-goals

- **Push-to-main runs** (react-doctor records a score on main pushes) — the
  generated workflow triggers on `pull_request` only; push handling is a future
  extension (Open question 5).
- **"Fixed issues" / score tracking vs the base branch** — that requires a
  second scan of the base branch; the sticky comment summarizes *this* scan's
  scoped findings only.
- **`ci config` command** (react-doctor's blocking reconfiguration) — users edit
  the `with:` block of the generated workflow like any other workflow file.
- **GitLab CI scaffold** — PLAN §6 keeps it out of scope.
- **Rule-doc links inside comments** — canonical docs URLs arrive with F017/F023;
  comments carry rule id + message only.
- **Auto-fix suggestions** in review comments.
- **Checks API / check-run annotations** — the PLAN line says commit status;
  check runs are a separate contract (constitution §5) if ever wanted.
- **Monorepo `project` multi-target input** (react-doctor has one) — our `scan`
  takes one `[path]`; the `directory` input covers a single target.
- **Runtime findings** — Phase 5 (F018–F021) owns anything non-static.

## User stories

1. **Backend developer** — runs `npx backend-doctor@latest ci install` once in
   her repo. From then on every PR gets a sticky comment ("2 errors, 5 warnings
   on changed lines") and inline comments exactly where the changed lines are.
   Nothing fails by default; when the team trusts the noise level she flips
   `blocking: error` in the workflow's `with:` block.
2. **CI author** — reads the generated workflow and sees a boring, minimal file:
   PR trigger, explicit permissions, concurrency group, `fetch-depth: 0`
   checkout, one `uses:` step. Exit codes mean 0 = green, 1 = blocking threshold
   hit, 2 = wiring broken (missing report, non-PR event, unreadable inputs) —
   the same 0/1/2 discipline as `scan`.
3. **AI agent** — consumes `--dry-run` output: one JSON envelope of the exact
   payloads (`comment`, `reviewComments`, `status`) that posting would send, so
   an agent can preview, diff, or relay them without network access; diagnostic
   ids in the underlying report stay deterministic across pushes, which is what
   makes the sticky-comment dedup stable.

## Contract / Model

Parts marked **[OQ-n]** are gated on the open questions; the text below states
the recommended shape.

### CLI surface (additive; `scan`/`init` untouched)

```
backend-doctor ci install [--force] [--action-ref <owner/name@ref>]
  Writes .github/workflows/backend-doctor.yml under the current directory.
  --force         overwrite an existing workflow file
  --action-ref    the uses: ref baked into the generated workflow [OQ-1]

backend-doctor ci report --report <path> [options]
  Reads a JSON report (as written by `scan --format json`) plus GitHub Actions
  context from the environment; posts or previews the PR surfaces.
  --report <path>            the scan's JSON report file (required)
  --blocking <mode>          none (default) | error | warn
  --event <path>             event JSON; default $GITHUB_EVENT_PATH
  --no-comment               skip the sticky PR comment
  --no-review-comments       skip inline review comments
  --no-commit-status         skip the commit status
  --max-review-comments <n>  inline comment cap; default 50 (RESEARCH precedent)
  --dry-run                  print the exact payloads as one JSON object to
                             stdout; perform no network calls
```

Exit codes (constitution §5 discipline, extended additively for `ci report`):

- `ci install`: `0` file written; `2` workflow already exists (without
  `--force`) or the target is unwritable. Usage errors write to stderr and
  nothing to stdout.
- `ci report`: `0` done and the blocking threshold (if any) is not hit;
  `1` blocking threshold hit (≥1 error-severity finding under `error`, ≥1
  finding of any severity under `warn`); `2` usage/environment error (missing
  or unreadable report/event, non-`pull_request` event, missing context).
  Note `1` still means "diagnostics found" — the same meaning as `scan`'s 1,
  modulated by the configured blocking level.
- Success paths: machine output on stdout, empty stderr. Warnings (skipped
  surfaces) go to stderr one line each, named per surface.

### Generated workflow (byte-deterministic template, no timestamps)

```yaml
name: Backend Doctor

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  issues: write
  pull-requests: write
  statuses: write

concurrency:
  group: backend-doctor-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  backend-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: <action-ref>
```

`<action-ref>` defaults to a named constant in source [OQ-1] and is replaced
verbatim by `--action-ref`. No `with:` block — action defaults are advisory;
users add inputs themselves.

### Composite action `action.yml` (this repository root)

Composite action, inputs (all strings):

| input | default | meaning |
|---|---|---|
| `blocking` | `none` | `none` \| `error` \| `warn` (G4) |
| `base` | *(empty)* | `--base` override; empty ⇒ `origin/<pr base ref>` from the event |
| `directory` | `.` | scan target passed to `scan [path]` |
| `comment` | `true` | sticky PR comment on/off |
| `review-comments` | `true` | inline review comments on/off |
| `commit-status` | `true` | commit status on/off |
| `review-comments-max` | `50` | inline comment cap |
| `version` | `latest` | CLI version to install [OQ-2] |

Steps:

1. `actions/setup-node@v4` (Node 22).
2. Install the CLI once [OQ-2 — recommended: `npm install -g backend-doctor@<version>`].
3. Scan step: `backend-doctor scan <directory> --scope lines --base <resolved
   base> --format json > "$GITHUB_WORKSPACE/backend-doctor-report.json"`, with
   exit 0/1 tolerated (`|| true`) so findings don't abort the job; exit 2 is
   handled loudly by step 4 (missing report file ⇒ `ci report` exits 2).
4. Report step: `backend-doctor ci report --report "$GITHUB_WORKSPACE/
   backend-doctor-report.json" --blocking <blocking> [--no-… per inputs]
   --max-review-comments <n>` with `GITHUB_TOKEN` in env. This step's exit code
   is the job's verdict.

### Surfaces and payloads

- **Event context** (from the event JSON + env): `pull_request.number`,
  `pull_request.base.ref`, `pull_request.head.sha`, `GITHUB_REPOSITORY`,
  `GITHUB_TOKEN`, `GITHUB_API_URL` (default `https://api.github.com`),
  `GITHUB_SERVER_URL`/`GITHUB_RUN_ID` for the status `target_url`. A
  non-`pull_request` event ⇒ exit 2, nothing posted (AC-9).
- **Sticky comment** — issues API (`POST`/`PATCH
  /repos/{repo}/issues/{n}/comments`). Identified by the marker
  `<!-- backend-doctor:sticky -->` at the end of the body; the posting step
  lists existing comments and updates the marked one, else creates (AC-13).
  Body (pure function of the report): heading with `mode` and `scope.base`
  (both fields exist since F015), counts by severity, per-file sections with
  `path:L<line>` and rule ids, a visible note when `skippedChecks` is
  non-empty (project rules skipped in partial scope — constitution §8), the
  "+N more" note when review comments were capped, and the marker. No
  timestamps, no run links in the body (G6).
- **Inline review comments** — pulls API (`POST /repos/{repo}/pulls/{n}/comments`)
  with `commit_id` = `head.sha`, `path`, `line`, `side: "RIGHT"`, body
  `**<rule>** (<severity>): <message>`. Sourced from the report's diagnostics
  in report order (engine order is deterministic), capped at
  `--max-review-comments`. Diagnostics are already line-scoped by
  `--scope lines`, so every finding is on a changed line by construction.
- **Commit status** — `POST /repos/{repo}/statuses/<head.sha>` with `context`
  `backend-doctor`, `state` `success`/`failure` (failure ⇔ the blocking
  threshold is hit — under `blocking: none` always `success`), `description`
  `"<e> errors, <w> warnings (blocking: <mode>)"`, `target_url` the run URL.
- **REST client** — global `fetch` against `GITHUB_API_URL`, `Authorization:
  Bearer $GITHUB_TOKEN`, JSON bodies; comment listing uses `per_page=100` and
  follows the `Link` header before deciding create-vs-update. A missing token
  or any non-2xx ⇒ that surface is skipped with a named stderr warning (AC-12).
- **`--dry-run`** prints one JSON envelope to stdout:
  `{ "comment": { "body": "…" } | undefined, "reviewComments": [payload…] | undefined,
  "status": {state, description, context, target_url} | undefined }` — exactly
  what posting would send, omitted per disabled surface; byte-deterministic
  (AC-5, AC-14).

### Constitution notes

- §1 (deterministic): the engine and `scan` are untouched; payload builders are
  pure and tested for byte-determinism. `ci report` makes network calls, but it
  is an explicit, user-invoked integration step *outside analysis* — the
  constitution's constraint is on the engine (spelled out in OQ-3 for sign-off).
- §5 (stable contracts): additive CLI growth; `scan` flags, config fields,
  report schema and `schemaVersion` untouched; the new exit-1 meaning for
  `ci report` is documented here and in `--help`.
- §8 (fail soft, report loud): surfaces skip with named warnings; the sticky
  comment surfaces `skippedChecks` from partial-scope scans.
- §10 (boring surface): `ci` was already the reserved command name; it grows
  two subcommands and no new top-level commands.

## EARS acceptance criteria

**`ci install`**

- **AC-1.** WHEN `ci install` runs in a directory with no existing
  `.github/workflows/backend-doctor.yml` THE SYSTEM SHALL create parent
  directories, write the workflow with the byte-deterministic template (PR
  trigger types `opened, synchronize, reopened`; the four `permissions` keys;
  concurrency group `backend-doctor-…` with `cancel-in-progress: true`;
  `fetch-depth: 0` checkout; the action ref on the final `uses:`), exit `0`,
  print the created path to stdout, and write nothing to stderr.
- **AC-2.** WHEN the workflow file already exists THE SYSTEM SHALL exit `2`,
  leave the existing file byte-identical, and name its path on stderr; WHEN
  `--force` is passed THE SYSTEM SHALL overwrite it with the deterministic
  template and exit `0`.
- **AC-3.** WHEN `--action-ref <ref>` is passed THE SYSTEM SHALL bake `<ref>`
  verbatim into the `uses:` line; WHEN it is omitted THE SYSTEM SHALL bake the
  default constant [OQ-1].

**Composite action (static contract)**

- **AC-4.** WHEN `action.yml` at the repository root is read THE SYSTEM SHALL
  declare a `composite` action whose inputs are exactly `blocking` (default
  `none`), `base` (empty), `directory` (`.`), `comment` (`true`),
  `review-comments` (`true`), `commit-status` (`true`),
  `review-comments-max` (`50`), `version` (`latest`), and whose steps run the
  scan with `--scope lines … --format json` redirected to the report file and
  then `ci report`.

**`ci report`**

- **AC-5.** WHEN `ci report --dry-run` runs with a valid report and a
  `pull_request` event THE SYSTEM SHALL print to stdout the single JSON
  envelope containing the sticky body (counts by severity, per-file sections,
  skippedChecks note when present, marker), one review payload per diagnostic
  (`path`, `line`, `side: "RIGHT"`, body with rule and severity), and the
  status payload (`context: "backend-doctor"`, `state`, description with
  counts); stderr SHALL stay empty and the exit code SHALL be `0` under
  `blocking: none` regardless of findings.
- **AC-6.** WHEN `blocking: error` and the report has ≥1 error-severity
  diagnostic THE SYSTEM SHALL exit `1` and mark the status payload `failure`;
  WHEN `blocking: warn` and the report has ≥1 diagnostic of any severity THE
  SYSTEM SHALL exit `1`; in every other case THE SYSTEM SHALL exit `0` with
  status state `success`.
- **AC-7.** WHEN the diagnostic count exceeds `--max-review-comments` THE
  SYSTEM SHALL emit exactly that many review payloads in report order and the
  sticky body SHALL contain a "+N more" note with the omitted count.
- **AC-8.** WHEN `--no-comment`, `--no-review-comments` or
  `--no-commit-status` is passed THE SYSTEM SHALL omit the corresponding
  payloads from dry-run output entirely.
- **AC-9.** WHEN the resolved event is not `pull_request` (e.g. `push`) THE
  SYSTEM SHALL exit `2`, write the event name to stderr, and emit no payloads.
- **AC-10.** WHEN required context is missing (no event file at
  `$GITHUB_EVENT_PATH`/`--event`, no report at `--report`, no
  `GITHUB_REPOSITORY`) THE SYSTEM SHALL exit `2` naming the missing piece on
  stderr and write nothing to stdout.
- **AC-11.** WHEN the report file is missing, unparseable, or its
  `schemaVersion` ≠ `1` THE SYSTEM SHALL exit `2` with the reason on stderr.
- **AC-12.** WHEN a posting call fails (missing `GITHUB_TOKEN`, non-2xx
  response) THE SYSTEM SHALL post the remaining surfaces, write one stderr
  warning naming each failed surface, and still exit per AC-6 (fail soft,
  visible).
- **AC-13.** WHEN the existing-comment list contains a comment bearing the
  sticky marker THE SYSTEM SHALL update that comment (`PATCH` to its id)
  instead of creating a new one; WHEN it does not THE SYSTEM SHALL create
  (`POST`) exactly one.
- **AC-14.** WHEN `--dry-run` runs twice with the same report, event and env
  THE SYSTEM SHALL produce byte-identical stdout.

## Testing strategy (TDD)

- **Unit — `tests/unit/ci/`**
  - `workflow-template.test.ts` — the pure template renderer: required
    fragments present, `--action-ref` substitution, byte-equality of double
    render (no timestamps). No fixtures.
  - `report-surfaces.test.ts` — pure builders over a hand-built
    `ReportDocument` fixture (and a `skippedChecks` variant, a zero-findings
    variant, a >50-diagnostics variant): sticky body sections + marker + "+N
    more", review payload order/cap/`side`, status state mapping for every
    (blocking × severities) combination, disabled-surface omission, non-PR
    event rejection, envelope determinism. Covers the builder halves of
    AC-5..AC-9, AC-14.
  - `posting.test.ts` — the REST client with an injected fake `fetch`:
    create-vs-PATCH dedup via the marker (AC-13), non-2xx ⇒ warning + continue
    (AC-12), missing token ⇒ skip, `Link`-header pagination walk.
- **e2e — `tests/e2e/ci.test.ts`** (built bin via `runCli`, temp dirs):
  - AC-1..AC-3: `ci install` in a temp dir (twice: create → exit 2 → `--force`),
    stdout/stderr purity, byte-determinism of the file.
  - AC-4: read `action.yml` from the repository root, assert the input names,
    defaults and step fragments (string-level; no YAML parser — no new deps).
  - AC-5..AC-11, AC-14: `ci report --dry-run` with a generated report file +
    event JSON in a temp dir; `JSON.parse` the envelope and assert shape;
    stderr purity; all exit codes; byte-equality double run.
  - AC-12 (offline): non-dry-run with `GITHUB_TOKEN` unset and
    `GITHUB_API_URL` pointed at a closed local port — surfaces warn on stderr,
    the blocking exit code is still honored, no real network is touched.
- No `tests/fixtures/` additions; existing suites must stay green unchanged
  (the new command is additive).

## Open questions for review

1. **Action identity: what `uses:` ref does `ci install` bake in?** The
   composite action lives at this repository's root, so the generated workflow
   must reference `<owner>/<repo>@<ref>`. This repo is currently
   `yamkin29/Node-doctor` on GitHub; the package is `backend-doctor` (npm name
   reserved for F023), and a repo rename before publish would be natural.
   (a) Constant `yamkin29/backend-doctor@v1` (post-rename coordinates) plus an
   `--action-ref` flag for override — recommended: the flag keeps installs
   testable and correct before/after any rename without source edits.
   (b) Constant only, no flag (users hand-edit the workflow).
   (c) Current coordinates `yamkin29/Node-doctor@v1`.
   **Recommendation: (a).**
2. **How the action installs the CLI.** (a) `npm install -g
   backend-doctor@<version input>` — recommended: react-doctor parity (their
   action consumes the published package), fast, boring; it activates at F023
   and is intentionally inert until then. (b) Build from the action checkout
   (`pnpm install && pnpm build` inside the user's job) — works today, but
   makes every user PR pay our toolchain cost and needs pnpm on the runner.
   **Recommendation: (a).**
3. **`ci report` as a CLI subcommand** (recommended) vs a standalone `.mjs`
   script shipped beside `action.yml`. The subcommand is typed against
   `ReportDocument`, unit-testable with injected `fetch`, keeps `action.yml`
   ~40 lines, and reuses the constitution-reserved `ci` command; it does mean
   the CLI performs network calls — outside analysis (the engine stays
   network-free, constitution §1), which I flag here explicitly for sign-off.
   The script alternative would duplicate report-schema knowledge untyped and
   be testable only through string splices. `--dry-run` ships with it either
   way. **Recommendation: subcommand.**
4. **Blocking semantics.** (a) react-doctor's trio `none` (default; never
   fails, status always `success`) / `error` (fail on ≥1 error-severity) /
   `warn` (fail on ≥1 finding) — recommended: adopted precedent, maps cleanly
   onto our exit-code discipline (`1` = threshold hit). (b) Boolean
   `blocking: true` (loses the advisory tier). **Recommendation: (a).**
5. **Workflow trigger scope.** (a) `pull_request` only — recommended: matches
   the PLAN line (PR comment/inline/status) and keeps "main never goes red
   over pre-existing issues" trivially true; push-to-main status can be added
   additively later (constitution §5). (b) Add `push: branches: [main]` with
   status-only behavior now (react-doctor parity; +1 event path to design and
   test). **Recommendation: (a).**
