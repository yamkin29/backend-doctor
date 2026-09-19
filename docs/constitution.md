# Constitution — backend-doctor

Non-negotiable principles. Every spec, design and task is checked against this file.
Changes to this document require explicit discussion before merging.

## 1. Deterministic by default

The engine contains no LLM calls and no network calls during analysis. Running the same
scan twice on the same tree produces byte-identical output (ordering, ids, messages).
LLMs may *consume* our outputs (JSON/JSONL, rule docs), but never *produce* them.

## 2. Precision over recall

A rule that cries wolf is worse than a missing rule. Every rule has a false-positive
budget: if the good eval corpus (F022) shows findings on clean code, the rule is fixed
or demoted before anything else ships. New rules start as `warn`, never `error`, until
they have survived at least one eval run.

## 3. Every rule ships with tests and docs

A rule is not done unless it has:

- `valid/` and `invalid/` fixtures under `tests/fixtures/<rule-id>/`,
- snapshot tests of the exact diagnostics (file, line, column, message),
- a markdown doc at `docs/rules/<rule-id>.md` (problem, bad/good examples, config),
- a category, a default severity and a stable kebab-case id (`backend-doctor/rule-name`).

Rule docs are generated/validated by a script so docs cannot drift from the registry.

## 4. Parser-agnostic core

Rules are written against our own `ParserAdapter` abstraction, not against ts-morph
types. Migrating the adapter (ts-morph → oxc-parser, Engine v2) must not require
touching any rule. If a rule needs something the adapter does not expose, the adapter
grows first.

## 5. Stable, versioned contracts

- The JSON report carries `schemaVersion`. Breaking changes bump it; consumers must be
  able to branch on the version.
- Diagnostic `id` is deterministic (derived from file/rule/position), so CI
  conversations can reference the same finding across runs.
- CLI exit codes are fixed: `0` = ok, `1` = error-severity diagnostics found,
  `2` = config or usage error.
- CLI flags and config fields are additive; removals/deprecations are announced in
  release notes one minor version ahead.

## 6. SDD for features, TDD for tasks

- No implementation before the feature's `spec.md` + `design.md` + `tasks.md` exist and
  the spec has been reviewed.
- Every task in `tasks.md` is executed red → green → refactor: the failing test is
  written first, then the minimal implementation, then cleanup. Only green states are
  committed.
- Specs use EARS-style acceptance criteria (`WHEN … THE SYSTEM SHALL …`) so they are
  mechanically checkable.

## 7. Zero intrusion

Analysis must not require changes to the user's code, build config, or runtime.
Static scanning reads the tree; the runtime probe (Phase 5) instruments via a
`--require` hook and never asks the user to edit their app.

## 8. Fail soft, report loud

A crashing rule must never crash the scan: the runner isolates rules, turns internal
errors into diagnostics tagged `internal`, and continues. Silent suppression is not
allowed — a skipped file or failed rule is always visible in the report
(`projects[].skippedChecks`).

## 9. Local-first, private by default

Scans, traces and reports stay on disk by default. No telemetry in MVP; if telemetry
ever lands it is opt-in and content-free. Runtime traces are treated as sensitive
(they contain URLs and paths) and are never sent anywhere.

## 10. Small, boring surface

The CLI has few commands (`scan`, `rules`, `init`, `ci`, `probe`), few flags, and
predictable behavior. Cleverness lives inside the engine, not in the UX.
