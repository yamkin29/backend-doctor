# Spec 030 — Introduced findings (F030)

- **Status:** Implemented (2026-10-18)
- **Approval:** 2026-10-18: the user accepted the proposed scope and requested implementation on a separate branch.
- **Phase:** 4 — Integrations
- **Depends on:** F003 engine, F015 diff scopes, F021 combined reports, F026 coverage reporting (Done)
- **Blocks:** Future adoption of baseline comparison in CI and agent workflows.

## Problem

`--scope changed` reports every finding in changed files, including existing debt.
Developers need a separate mode that compares the current tree with its Git baseline
and reports introduced findings. Existing diagnostic IDs include positions, so ID
subtraction would falsely classify findings as new after inserting lines.

## Goals

- Add `--scope introduced`, preserving the meanings of all existing scopes.
- Compare changed supported source files with their baseline counterparts using
  the same running analyzer and current effective rule/ignore configuration.
- Match unchanged findings after line shifts and Git-detected file renames;
  preserve additional occurrences of the same issue.
- Keep snapshots local, leave the working tree/index untouched, and execute no
  historical application code or historical backend-doctor configuration.
- Expose incomplete comparison through `skippedChecks`; keep healthy checks running.
- Add no dependencies or new public library exports.

## Non-goals

- Whole-project rule comparison: a future full-tree baseline feature owns graph checks.
- Automatic changes to GitHub Actions or shipped agent scan commands: subsequent integration work owns adoption.
- Staged-only scans, contextual scopes, monorepo orchestration, and persisted baselines: separate backlog features.
- Semantic equivalence after arbitrary refactors: unmatched changed source remains visible.
- Comparing runtime evidence with historical source: F021 continues to own unfiltered runtime merging.

## User stories

1. **Backend developer:** adds a finding beside an old one, runs `scan --scope introduced`, and sees the new occurrence.
2. **CI author:** passes `--base origin/main --format json` and gets reproducible findings and visible comparison limitations.
3. **AI agent:** consumes JSON/JSONL findings with the same current-tree locations and IDs as ordinary scans.

## Contract / Model

### CLI and baseline

```sh
backend-doctor scan [path] --scope introduced [--base <ref>]
```

The default base is `HEAD`. With history, the baseline commit is the merge-base of
the requested ref and `HEAD`. Compare its tracked content with current working-tree
content, including staged and ordinary non-ignored untracked files. Deleted files
produce no current findings. An unborn `HEAD` with the default base uses an empty
baseline; explicit invalid refs and unrelated histories are usage/environment errors.
Git-detected renames pair the old and new paths. Copies do not inherit another file's
baseline. Untracked moves not detected as renames are treated as new files.

`--file` remains exclusive to `--scope files`. Config discovery, explicit config,
ignore globs, dump-config, terminal activation, and supported extensions retain
their existing contracts. No scope/base config fields are introduced.

### Matching

Match within paired files using rule ID, message, and a source anchor, consuming
each baseline occurrence at most once. Source anchors use parser-derived source
tokens with trivia removed; no regex-only source rewriting or position-only IDs.
Prefer occurrences mapped through unchanged diff lines, then match remaining
identical anchors to allow movement and formatting. Different anchors/messages are
not assumed equivalent. Internal failure diagnostics are never suppressed.

The comparison is limited to file rules and the same changed-file model context
used by F015. Each side uses its own tracked package/TypeScript/framework metadata
and current effective analyzer configuration. Historical backend-doctor config is
not loaded. A newly enabled framework can therefore introduce findings.

### Reports and errors

- `mode` adds `"introduced"`, following F015's additive mode extension precedent;
  `schemaVersion` remains `1`. Existing report shapes remain unchanged.
- `scope: { base: string }` is present, with the requested ref as in F015.
- Diagnostic fields, IDs, ordering, and current file paths remain unchanged.
- `projects[].complete` is `false`; project rules are visibly skipped.
- Baseline read/parse/config/rule failures add `check: "baseline-comparison"` entries
  with repository-relative context. Affected current findings remain visible as
  unverified candidates; a failed baseline never establishes that they are new.
  JSON coverage and pretty/console output must explain this distinction.
- Git prerequisite/ref/history failures exit `2`, with stderr and empty stdout.
- Other verdicts remain `0` for no reported error findings and `1` for reported
  error findings. Skipped checks do not introduce a fourth verdict.
- JSONL stays diagnostic-only; JSON must be used to inspect coverage limitations.
- Runtime findings merged through `--trace` remain unfiltered, as in F021 AC-10;
  documentation explains that they are not classified by the Git comparison.
- Temporary paths never leak into successful reports or baseline failure reasons.

## EARS acceptance criteria

- **AC-1:** WHEN existing scopes run THE SYSTEM SHALL preserve their behavior and report contracts.
- **AC-2:** WHEN only an existing finding shifts because lines were inserted or deleted THE SYSTEM SHALL omit it from introduced output.
- **AC-3:** WHEN a new finding is added beside an existing finding THE SYSTEM SHALL report the new occurrence at its current location.
- **AC-4:** WHEN another identical occurrence is added THE SYSTEM SHALL retain the additional occurrence without consuming a baseline occurrence twice.
- **AC-5:** WHEN Git detects a rename THE SYSTEM SHALL compare findings with the old path and report retained findings under the current path.
- **AC-6:** WHEN a source file is new, untracked and non-ignored, or added in an unborn repository THE SYSTEM SHALL report its file-rule findings.
- **AC-7:** WHEN a source file is deleted, ignored, unsupported, or outside the scan target THE SYSTEM SHALL omit its findings.
- **AC-8:** WHEN an explicit base is provided THE SYSTEM SHALL use its merge-base with HEAD; WHEN omitted THE SYSTEM SHALL compare against HEAD.
- **AC-9:** WHEN the current effective analyzer configuration changes THE SYSTEM SHALL apply it to both sides without loading historical analyzer config.
- **AC-10:** WHEN a baseline source cannot be parsed or a baseline check fails THE SYSTEM SHALL retain affected current candidates and report the comparison limitation.
- **AC-11:** WHEN Git/ref/history prerequisites fail THE SYSTEM SHALL exit 2 with an explanation on stderr and no stdout report.
- **AC-12:** WHEN introduced scope runs THE SYSTEM SHALL mark coverage partial and visibly skip project rules.
- **AC-13:** WHEN identical inputs are scanned twice THE SYSTEM SHALL emit byte-identical reports without temporary snapshot paths.
- **AC-14:** WHEN a finding survives comparison THE SYSTEM SHALL preserve its current-tree diagnostic ID and fields.
- **AC-15:** WHEN snapshot creation or cleanup runs THE SYSTEM SHALL preserve working files, index, branch, refs, symlinks, and historical code execution state.
- **AC-16:** WHEN introduced output contains an error finding THE SYSTEM SHALL exit 1; WHEN it contains only warnings or no findings THE SYSTEM SHALL exit 0.
- **AC-17:** WHEN introduced mode is used with JSONL or an interactive console THE SYSTEM SHALL retain those formats' existing behavior and show available coverage through JSON/pretty/console.
- **AC-18:** WHEN a runtime trace is supplied THE SYSTEM SHALL preserve runtime findings without baseline filtering.
- **AC-19:** WHEN source anchors move or change only in trivia THE SYSTEM SHALL consume matching baseline occurrences deterministically.
- **AC-20:** WHEN a source anchor changes in substantive tokens THE SYSTEM SHALL retain the unmatched current finding.

## Testing strategy (TDD)

Use temporary Git repositories from `tests/unit/scope/git-test-support.ts` rather
than committed fixture repos. Unit tests cover matching, multiplicity, line mapping,
and snapshot safety. Integration tests run real scans against current/baseline trees.
CLI tests spawn the built bin for flag validation, formats, exit codes, and determinism.
The design's test map covers every AC. A live CLI smoke and interactive terminal
check complement automated tests. Final verification follows AGENTS.md.

## Review decisions

The user accepted the preceding proposal on 2026-10-18 and requested implementation.
The proposed new scope, unchanged existing scopes, shared current configuration,
position-aware matching, explicit baseline limitations, and file-rule-only initial
scope are approved. No new dependencies or constitution amendments are requested.
Report mode follows spec 015's existing additive-extension policy. No unresolved
scope questions remain; implementation deviations are recorded in tasks.md.
