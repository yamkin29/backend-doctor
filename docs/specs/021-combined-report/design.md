# Design 021 — Combined report (static + runtime)

Spec: [spec.md](./spec.md) (Approved 2026-09-21). All OQs resolved by adopting
the recommendations.

## Module layout

| File | Purpose |
|------|---------|
| `src/runtime/load.ts` (new) | `loadTraceSession(absDir)` — validates a probe session directory (dir exists, `findings.json` + `session.json` present, parseable, `traceSchemaVersion: 1`, `session.cwd` string) and returns `{ findings, findingsPath, sessionCwd, provenance }`. All I/O of the feature lives here. |
| `src/runtime/merge.ts` (new) | `buildRuntimeDiagnostics(input)` — pure synthesis of `Diagnostic[]` from a parsed findings document (blocking call sites + N+1 endpoints). No I/O. |
| `src/core/types.ts` | `ReportDocument` gains `runtime?: RuntimeProvenance`; new exported `RuntimeProvenance { sessionDir: string; traceSchemaVersion: 1 }`. |
| `src/core/report.ts` | `buildReport(result, runtime?)` — appends the provenance block as the document's last key when present. |
| `src/reporters/pretty.ts` | One additive `Runtime trace: <sessionDir>` header line when `doc.runtime` is set. `json`/`jsonl` untouched (passthrough). |
| `src/cli/run.ts` | `scan` gains `--trace <dir>`. |
| `src/cli/commands/scan.ts` | Loads the trace before `runScan` (red paths → exit 2 before any scanning), merges runtime diagnostics after the scan, re-sorts with the existing exported `sortDiagnostics`, passes provenance to `buildReport`. |
| `tests/unit/runtime/merge.test.ts` (new) | Synthesis pins (AC-4…AC-9, AC-14). |
| `tests/unit/runtime/load.test.ts` (new) | Loader happy path + every red path (AC-1, AC-2). |
| `tests/unit/report.test.ts` | Provenance block appended last / absent (AC-12); exitCodeFor re-pin with runtime warns (AC-11). |
| `tests/unit/reporters.test.ts` | Pretty header line + `../`-relative rendering; jsonl runtime lines (AC-13). |
| `tests/unit/config/validate.test.ts` | Runtime ids rejected in `rules`/`ignore.rules` (AC-15). |
| `tests/e2e/combined-report.test.ts` (new) | Full loop against real probe fixtures + CLI red paths (AC-1…AC-3, AC-5, AC-8, AC-10…AC-13 CLI level). |

## Key decisions

1. **The merge is a scan-command composition, not an engine stage.**
   Alternative considered: extend `ScanInput`/`runScan` with the trace and
   merge inside the pipeline. Rejected: the static engine (collect → parse →
   rules → sort) stays byte-for-byte untouched — smaller blast radius on the
   most contract-pinned module; `scanCommand` appends runtime diagnostics
   after `runScan` returns (which is also *after* the `lines`-scope filter,
   satisfying AC-10 by construction) and re-sorts with the already-exported
   `sortDiagnostics`. Cost: a second sort of the merged array — negligible
   and deterministic (V8 sort is stable; cross-kind ties are impossible
   because rule ids differ).
2. **Loader validates shape minimally; missing findings sections degrade to
   zero diagnostics.** The loader checks: directory is a directory; both JSON
   files parse; both carry `traceSchemaVersion: 1`; `session.cwd` is a string
   (Contract: "a session directory without a well-formed session.json is not
   a mergeable trace" — a missing `cwd` would make blocking-call positioning
   a guess, and wrong positioning is a lie, so it is a red path). A v1
   findings document with missing `blocking`/`http`/`collectors` sections
   yields zero runtime diagnostics instead of an error: absence of findings
   is not load-bearing, the trace contract itself says consumers ignore
   unknown/absent fields, and erroring would forbid forward-compatible v1
   producers. Recorded asymmetry, both sides tested.
3. **New `src/runtime/` module rather than `src/probe/load.ts`.** The merge
   consumes the trace contract but belongs to the report side; `probe/` stays
   write-only. Import direction `runtime → probe/types` only; `core/types`
   declares its own structural `RuntimeProvenance` (literal `1`), so no
   `core → probe` edge and no cycle.
4. **Rule ids are report-level strings, not registered rules.**
   `backend-doctor/runtime-blocking-call` and
   `backend-doctor/runtime-possible-n1` never enter `RuleRegistry` (spec OQ-2
   resolution): no docs/fixtures obligations (constitution §3 binds
   registered rules), config keeps rejecting them (AC-15). The `Diagnostic`
   literal is built in the declaration order of `Diagnostic` (id, filePath,
   line, column, rule, category, severity, message, tags) — the spec 017
   jsonl construction-order pin holds.
5. **Message templates pinned** (values are `String(number)` of the
   findings.json values — the probe pre-rounds to 3 decimals, JSON round-trip
   is exact):
   - blocking: `${api} blocked the event loop for up to ${maxMs}ms (${count} call(s), total ${totalMs}ms)`
   - N+1: `endpoint ${method} ${route} saw up to ${max} db queries in one request (possible N+1)` (byte-equal to the F020 findings warning template in `src/probe/analysis.ts`).
6. **Blocking-call path resolution** mirrors the hook's `relativeToCwd`:
   absolute recorded paths are used as-is; relative ones resolve against the
   session's recorded `cwd` (`path.resolve(sessionCwd, recorded)`), which is
   the probe process's cwd — the only base the recording is relative to. The
   diagnostic id uses the target-relative posix form of the resolved absolute
   path (the `createDiagnosticId` convention); null line/column → 1.
7. **e2e uses real probe sessions, unit tests hand-craft session dirs.**
   e2e runs `probe` on the existing fixtures — `blocking.cjs` with
   `BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS: "1"` (yields a `crypto.pbkdf2Sync`
   row with a relative `file`), `prisma-app.cjs` with
   `BACKEND_DOCTOR_PROBE_N1_THRESHOLD: "2"` (yields the `/bulk` N+1 warning
   text) — then scans with `--trace` and asserts merged output. Hand-written
   synthetic session JSONs would bypass exactly the path-resolution and
   threshold plumbing the feature exists for. Merged ordering with static
   diagnostics uses the `tests/fixtures/engine/bad-app` tree (its four
   warn-severity static diagnostics at known positions) plus a trace whose
   culprit lies outside the scan root (`../`-relative sort form).

## Dependencies

None (OQ-5). Everything is node:fs/path + existing modules.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/unit/runtime/load.test.ts` — happy load; `tests/e2e/combined-report.test.ts` — merged report carries runtime diagnostics + provenance |
| AC-2 | `tests/unit/runtime/load.test.ts` — all red paths (dir absent, not a dir, findings missing/unparseable/wrong version, session missing/unparseable/wrong version/no cwd); e2e red paths (nonexistent dir, dir without findings.json) |
| AC-3 | e2e — `scan --format json` without `--trace`: no `runtime` key, byte-stable static output |
| AC-4 | `tests/unit/runtime/merge.test.ts` — relative resolution via session.cwd, absolute kept, nulls → 1, exact message/rule/category/severity/tags, target-relative id (incl. out-of-root `../` form) |
| AC-5 | `tests/unit/runtime/merge.test.ts` — at threshold / below threshold, exact F020 warning text, findings.json position; e2e — `/bulk` N+1 diagnostic |
| AC-6 | `tests/unit/runtime/merge.test.ts` — one diagnostic per row present (merge has no events path by construction) |
| AC-7 | `tests/unit/runtime/merge.test.ts` — empty findings → zero diagnostics; missing sections → zero diagnostics (decision 2) |
| AC-8 | e2e — merged array ordering: out-of-root runtime row before in-root static rows; `tests/unit/runtime/merge.test.ts` — id relative form |
| AC-9 | `tests/unit/runtime/merge.test.ts` — static diagnostic at the same site kept alongside the runtime row |
| AC-10 | e2e — `--scope files --file … --trace …`: runtime diagnostics present, project rules skipped visibly |
| AC-11 | `tests/unit/report.test.ts` — exitCodeFor re-pin with runtime warns; e2e — warn-only merged report exits 0 |
| AC-12 | `tests/unit/report.test.ts` — block appended last / absent; e2e — `runtime` block in JSON |
| AC-13 | `tests/unit/reporters.test.ts` — pretty header + `../` rendering + summary count, jsonl runtime lines in construction order; e2e — jsonl/pretty with a trace |
| AC-14 | `tests/unit/runtime/merge.test.ts` — byte-identical re-render for all three reporters |
| AC-15 | `tests/unit/config/validate.test.ts` — runtime ids rejected in `rules` and `ignore.rules` |
