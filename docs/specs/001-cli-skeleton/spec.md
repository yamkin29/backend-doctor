# Spec 001 — CLI skeleton & DX (F001)

- **Status:** Implemented
- **Phase:** 0 — Foundation
- **Depends on:** nothing (first feature)
- **Blocks:** F002 (config), F003 (engine core)

## Problem

backend-doctor has no runnable artifact. Every later feature (config, engine, rules,
runtime probe) plugs into a CLI and a scan pipeline that must exist first — with the
output contracts (formats, schema, exit codes) fixed on day one so that later features
extend them without breaking consumers.

## Goals

- A runnable `backend-doctor` bin (buildable, linkable, testable end to end).
- `scan [path]` command wired through an intentionally empty pipeline (zero rules in
  F001) so reporters and exit codes are exercised from the first commit.
- Three output formats: `pretty` (human), `json` (machine, `schemaVersion: 1`),
  `jsonl` (one diagnostic per line).
- Fixed exit codes 0 / 1 / 2 (constitution §5).
- Developer experience baseline: TypeScript strict, tsup build, vitest, Biome,
  GitHub Actions CI running lint + tests on push and PR.

## Non-goals

- Reading or validating user config files (F002). The `--config` flag is **reserved**:
  passing it is a usage error with a pointer to F002.
- tsconfig discovery, file parsing, any rules — F003+. `--ignore` is accepted but is a
  no-op until the engine exists (F003), and is documented as such in `--help`.
- Rich TUI output; `pretty` is plain text (colors optional, no interactivity).
- npm publishing (F023).

## User stories

1. As a backend developer, I run `npx backend-doctor scan .` and see a report of issues
   in my terminal.
2. As a CI author, I run `backend-doctor scan . --format json`, parse a stable JSON
   document, and my job fails only when error-severity diagnostics exist.
3. As an AI coding agent, I consume `--format jsonl` line by line without parsing a
   wrapper document.

## CLI contract (v1)

```
backend-doctor --version
backend-doctor scan [path] [--format <pretty|json|jsonl>] [--ignore <glob>]...

  path       directory or file to scan; default: current working directory
  --format   output format; default: pretty
  --ignore   glob to exclude; repeatable; no-op until F003 (accepted for compat)
  --config   reserved; supported from F002 — exits 2 with an explanation

Global: --version, -V, --help, -h
```

## JSON report schema (v1)

```json
{
  "schemaVersion": 1,
  "mode": "full",
  "directory": "<absolute path of the scanned directory>",
  "diagnostics": [],
  "projects": []
}
```

- `jsonl` prints zero or more lines — one diagnostic object per line — and nothing
  else on stdout.
- `pretty` prints a human summary (scanned directory, counts by severity); its exact
  layout is snapshot-tested and may evolve without a schema bump.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Scan completed, no error-severity diagnostics |
| 1 | Scan completed, ≥1 error-severity diagnostic |
| 2 | Usage or environment error (unknown option, bad `--format`, reserved `--config`, missing scan path) |

## EARS acceptance criteria

- **AC-1:** WHEN `backend-doctor --version` runs, THE SYSTEM SHALL print the package
  version to stdout and exit 0.
- **AC-2:** WHEN `scan <dir>` runs with no rules registered, THE SYSTEM SHALL print a
  pretty report containing the resolved scanned directory and "0 issues", and exit 0.
- **AC-3:** WHEN `scan` runs with `--format json`, THE SYSTEM SHALL print exactly one
  JSON document conforming to schemaVersion 1 to stdout and exit 0.
- **AC-4:** WHEN `scan` runs with `--format jsonl` and zero diagnostics, THE SYSTEM
  SHALL print nothing to stdout and exit 0.
- **AC-5:** WHEN an unknown option is passed, THE SYSTEM SHALL print a usage message
  to stderr and exit 2.
- **AC-6:** WHEN `--config` is passed, THE SYSTEM SHALL exit 2 and explain that config
  files are supported from F002.
- **AC-7:** WHEN `scan` runs on a path that does not exist, THE SYSTEM SHALL exit 2
  with a message naming the offending path.
- **AC-8:** WHEN `--format` receives a value other than `pretty|json|jsonl`, THE SYSTEM
  SHALL exit 2.
- **AC-9:** WHEN `scan` completes in any format, THE SYSTEM SHALL print report content
  only to stdout; stderr carries usage and error messages only.
- **AC-10:** WHEN CI runs on push or PR, THE SYSTEM SHALL run Biome lint and vitest and
  fail the job on any failure.

## Testing strategy (TDD)

- e2e tests spawn the built bin with argv and assert stdout / stderr / exit code for
  every AC above; each e2e assertion helper also checks AC-9 (stderr purity).
- Unit tests: report builder (empty input → exact v1 document), each reporter's output
  for empty and non-empty inputs, version resolution.
- Fixtures: temp directories created inside tests; no committed fixtures needed for
  F001.

## Open questions for review

1. Pretty layout — see design draft; happy to adjust wording before snapshots land.
2. Default path semantics: `scan` with no argument scans cwd (chosen); alternative is
   requiring an explicit path. Spec chooses cwd for agent-friendliness.
