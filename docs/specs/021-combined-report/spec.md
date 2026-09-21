# Spec 021 — Combined report (static + runtime) (F021)

- **Status:** Implemented (2026-09-21)
- **Phase:** 5 — Runtime engine
- **Depends on:** F018 Runtime probe runner (Done — the session directory and
  `findings.json` exist as a versioned contract), F019 Event loop & blocking
  attribution (Done — `blocking.calls[]` rows carry absolute `file`/`line`/
  `column`), F020 HTTP runtime tracing (Done — `http.endpoints[]` with
  `dbQueries.max` and the N+1 warning wording)
- **Blocks:** F022 Eval corpus (its probe check can assert merged findings on a
  whole bad app)

## Problem

The tool has two eyes that never meet. Static rules flag suspects in source
(`no-sync-fs-in-request-path`, `no-prisma-n-plus-one`, …); the probe records
what actually happened in a real run — blocking call sites with exact
`file:line`, endpoints whose single request issued dozens of DB queries. Today
a developer must read `scan` output and `findings.json` side by side and
correlate them by hand; an agent or CI consumer must understand two different
documents. The PLAN's F021 line — "merge runtime findings with static ones
(tag `runtime`), unified report and reporters" — is unimplemented. The
diagnostic model reserved the `Runtime` category on day one (spec 001/003,
`DIAGNOSTIC_CATEGORIES`), but no diagnostic has ever carried it. F021 lets
`scan` consume a probe session's `findings.json` and emit runtime findings as
diagnostics tagged `runtime`, so one report, in every existing format, tells
the whole story.

## Goals

- G1. **`scan --trace <session-dir>`** — a new optional scan flag. When given,
  after static analysis the scan loads `<session-dir>/findings.json`,
  synthesizes runtime diagnostics from it, and merges them into the report's
  single `diagnostics[]` array. The flag is purely additive: without it every
  report stays byte-identical to the pre-021 shape.
- G2. **Runtime diagnostics, exactly two kinds** — derived from the structured
  findings, never from `findings.warnings` strings:
  - *Blocking call site* (one per `blocking.calls[]` row): positioned at the
    row's `file`/`line`/`column` — the F019 hook records `file` relative to
    the probe process's cwd when the culprit is inside it
    (`relativeToCwd`, `src/probe/hook.ts`), so scan resolves a relative
    recording against `session.json`'s `session.cwd` from the same session
    directory (an absolute recording is used as-is; null line/column → 1,
    the runner's convention). Rule id
    `backend-doctor/runtime-blocking-call`, message carrying `api`, `count`,
    `maxMs`, `totalMs`.
  - *Possible N+1* (one per `http.endpoints[]` row whose
    `dbQueries.max >= collectors.n1Threshold`): rule id
    `backend-doctor/runtime-possible-n1`, message identical to the F020
    findings warning text (`endpoint <METHOD> <route> saw up to <max> db
    queries in one request (possible N+1)`). An endpoint has no source
    location: it is pinned at the merged `findings.json` path, line 1,
    column 1 — the diagnostic points at the evidence.
  Both kinds carry `category: "Runtime"`, `severity: "warn"`, and
  `tags: ["runtime"]`.
- G3. **Advisory by contract** — runtime diagnostics are always `warn` and can
  never introduce exit code 1 (the F018–F020 precedent "findings never
  influence probe exit codes" carries over to the merged report; only
  error-severity diagnostics flip it).
- G4. **Trace provenance in the report** — when a trace is merged, the report
  document gains an additive trailing `runtime` block
  (`{ sessionDir, traceSchemaVersion }`); without `--trace` the key is absent.
  `schemaVersion` stays `1` (additive growth, F019/F020 precedent).
- G5. **Unified reporters** — `json` serializes the merged document as-is;
  `jsonl` emits one line per diagnostic including runtime ones (agents filter
  on the `runtime` tag); `pretty` renders runtime diagnostics like any
  diagnostic plus one additive header line naming the merged session
  directory (the spec 004 frameworks-line precedent).
- G6. **Determinism** — given the same scan tree and the same `findings.json`,
  every format's output is byte-identical across runs; runtime diagnostics
  sort into the single existing global order (relative path, line, column,
  rule id) alongside static ones.

## Non-goals

- **Re-analysis of `events.ndjson`** — the scan consumes `findings.json` only;
  the probe's caps (top-50 call sites/endpoints/models) are its documented
  shape and are honored as-is. Recomputing aggregates in scan would duplicate
  the F019/F020 analysis and fork determinism; no feature line asks for it.
- **Making runtime findings config-tunable rules** — the `runtime-*` ids are
  report-level identifiers, not registered rules: config `rules`/`ignore.rules`
  keep rejecting them as unknown rule ids, and no `docs/rules/` entries are
  added (constitution §3 binds *registered* rules). Tunable runtime checks
  would need a rule kind with a trace input — no PLAN line owns that today.
- **New thresholds for lag, memory, GC, or slow endpoints** — those findings
  stay numbers in `findings.json`; turning them into diagnostics requires
  detection-threshold contracts nobody has approved (F022 material at the
  earliest).
- **Duplicating `findings.warnings[]` into the report** — cap notices and the
  no-attach warning remain findings.json/probe-stderr facts. (Consequence: a
  merged trace that recorded nothing yields zero runtime diagnostics; the
  findings document stays the record. Flagged in OQ-2.)
- **Multiple traces per scan** (`--trace` repeatable, cross-session
  aggregation) — one trace in F021; boring surface (constitution §10).
- **Probe-side changes** — probe never reads static reports; `session.json`,
  `events.ndjson`, and `findings.json` contracts are untouched. The merge
  lives entirely on the scan side.
- **CI surface changes** (`ci report`, GitHub Action) — they already consume
  scan JSON; runtime diagnostics flow through the existing payloads. Any
  dedicated runtime presentation there belongs to a later feature.
- **Runtime diagnostics in diff scopes' line filtering** — pinned below: scope
  filtering applies to static diagnostics only.
- **Windows-specific path handling in merged diagnostics** — POSIX-first like
  the rest of the toolchain.

## User stories

1. **Backend developer** — she probes her dev server
   (`backend-doctor probe -- npm run dev`), exercises the endpoints, then runs
   `backend-doctor scan --trace .backend-doctor/probe/<session>` and sees one
   report: static suspects and, tagged `runtime`, the call site that actually
   blocked the event loop for 152 ms and the endpoint that issued 25 queries
   per request. Where the static `no-prisma-n-plus-one` suspect and the
   runtime N+1 name the same flow, the evidence now sits in one list.
2. **CI author** — she adds `--trace` to the scan step pointing at a session
   directory produced by a probe job. Runtime findings arrive as warn-severity
   diagnostics: they show up in the report and PR surfaces but never flip the
   exit code on their own; exit semantics (0/1/2) are exactly as before. A
   missing or malformed trace is a usage error (exit 2) — never a silent
   scan-without-runtime.
3. **AI agent** — the agent consumes `--format jsonl` as before and branches
   on `tags.includes("runtime")` to separate measured facts from static
   analysis; every diagnostic keeps the pinned key set and deterministic id.
   In `--format json` it additionally reads the additive `runtime` block to
   attribute runtime findings to a trace session.

## Contract / Model

Parts marked **[OQ-n]** are gated on the open questions; the text below states
the recommended shape.

### CLI surface (additive; `probe`/`init`/`rules`/`ci` untouched)

```
backend-doctor scan [path] --trace <session-dir> [existing flags...]

  --trace <dir>  merge runtime findings from <dir>/findings.json (a probe
                 session directory, F018 layout) into the report as
                 diagnostics tagged "runtime".
```

Validation (each: exit `2`, reason on stderr, nothing on stdout, no report):

- `--trace` directory does not exist or is not a directory;
- `<dir>/findings.json` missing;
- `findings.json` not parseable as JSON;
- `findings.json.traceSchemaVersion` is not `1` (consumers branch on the
  version; scan does not guess);
- `<dir>/session.json` missing, unparseable, or carrying a
  `traceSchemaVersion` other than `1` — the relative blocking-call paths are
  resolved against its `session.cwd`, so a session directory without a
  well-formed session.json is not a mergeable trace.

All pre-021 `scan` behavior is unchanged when `--trace` is absent, including
byte-identical output for every format.

### Runtime diagnostic shape (exact)

```jsonc
{
  "id": "<deterministic, createDiagnosticId>",
  "filePath": "<absolute: call site file | findings.json path>",
  "line": 42, "column": 7,          // null → 1; N+1 → 1/1 at findings.json
  "rule": "backend-doctor/runtime-blocking-call",
                                    // or backend-doctor/runtime-possible-n1
  "category": "Runtime",
  "severity": "warn",
  "message": "readFileSync blocked the event loop for up to 152.1ms (3 call(s), total 456.8ms)",
  // N+1 message, identical to the F020 findings warning text:
  // "endpoint GET /users/:id saw up to 25 db queries in one request (possible N+1)"
  "tags": ["runtime"]
}
```

- Blocking-call messages are built from the findings row: `up to <maxMs>ms`,
  `<count> call(s)`, `total <totalMs>ms` — numbers as recorded in
  `findings.json` (already rounded to 3 decimals by the probe).
- Blocking-call positioning: `filePath` is absolute — the recorded path
  as-is when absolute, else `path.resolve(session.cwd, recorded)`. The
  diagnostic id uses the target-relative posix form of that path (the
  `createDiagnosticId` convention, same as static ids); a culprit outside
  the scan target sorts and renders by its `../`-prefixed relative form.
- N+1 positioning: `filePath` is the absolute `findings.json` path; id uses
  its target-relative form.
- Diagnostic ids use the existing `createDiagnosticId` over the same tuple as
  static diagnostics (relative posix `file`, line, column, rule, message
  included) — same trace, same id.
- Ordering: runtime diagnostics join `diagnostics[]` before the global sort,
  so the merged array obeys the one existing order (relative path, line,
  column, rule id). Paths outside the scan target sort by their `../`-prefixed
  relative form — deterministic, no special casing.
- A blocking-call site that coincides with a static diagnostic at the same
  file/line is kept alongside it — different rule ids; the runtime row is
  measured evidence, not a duplicate.
- Scope interplay: `--scope changed/files/lines` filtering applies to static
  diagnostics only; merged runtime diagnostics are always included
  (`project.complete` and `skippedChecks` semantics untouched).

### Report document (additive; `schemaVersion` stays 1)

```
{ schemaVersion, mode, [scope], directory, diagnostics[], projects[],
  [runtime: { sessionDir: string, traceSchemaVersion: 1 }] }
```

- `runtime` is appended last, only when `--trace` was given. `sessionDir` is
  the directory passed to `--trace` (absolute). Key order in JSON follows
  construction order (pinned by test).
- `mode`, `scope`, `projects[]`, and the static parts of `diagnostics[]` are
  byte-identical to the pre-021 report for the same tree.

### Reporters

- `pretty` — unchanged output plus, when a trace is merged, one header line
  `Runtime trace: <sessionDir>` after the `Frameworks:` line position
  (additive-line precedent, spec 004); runtime diagnostics render via the
  existing diagnostic line format (their `path.relative` form may prefix
  `../`); the summary line counts them like any warn.
- `json` — the merged document serialized as-is.
- `jsonl` — one diagnostic per line, runtime ones included, same key order
  (spec 017's construction-order pin holds; the runner's literal order is
  unchanged — runtime diagnostics are built with the same field order).

### Constitution notes

- §1 (deterministic): static analysis untouched; the merge is a pure function
  of (scan tree, findings.json); byte-identical outputs pinned by test. The
  runtime *values* inside a trace vary per run by nature — the documented
  F018 carve-out, unchanged.
- §5 (stable contracts): one additive flag, one additive optional report key,
  two new report-level rule-id strings; `schemaVersion` stays 1; exit codes
  untouched; config validation untouched (runtime ids are not accepted there
  — documented, not an accident).
- §8 (fail loud): a `--trace` that cannot be honored is exit 2 with a reason —
  never a silent static-only report; findings caps are honored as the
  contract's documented shape (they are not silent drops by scan).
- §9 (local-first): the merge reads a local file; nothing leaves the machine.
- §10 (small surface): one flag on an existing command; zero new commands.

## EARS acceptance criteria

**Trace loading and validation**

- **AC-1.** WHEN `--trace <dir>` points at a directory whose `findings.json`
  parses and carries `traceSchemaVersion: 1` THE SYSTEM SHALL merge runtime
  diagnostics into the report and add the `runtime` provenance block.
- **AC-2.** WHEN `--trace` is given and the directory does not exist, is not
  a directory, has no `findings.json`, has unparseable `findings.json`,
  carries a `traceSchemaVersion` other than `1`, or has a `session.json`
  that is missing, unparseable, or carries a `traceSchemaVersion` other than
  `1` THE SYSTEM SHALL exit `2` with the reason on stderr, nothing on
  stdout, and no report.
- **AC-3.** WHEN no `--trace` is given THE SYSTEM SHALL produce output
  byte-identical to the pre-021 report for every format (no `runtime` key, no
  runtime diagnostics, same exit codes).

**Synthesis**

- **AC-4.** WHEN `blocking.calls` is non-empty THE SYSTEM SHALL emit exactly
  one diagnostic per row positioned at the row's file (absolute as-is,
  relative resolved against the session's recorded `cwd`), line, and column
  (nulls → 1) with rule `backend-doctor/runtime-blocking-call`, category
  `Runtime`, severity `warn`, tags `["runtime"]`, and a message carrying the
  row's `api`, `count`, `maxMs`, and `totalMs`.
- **AC-5.** WHEN an endpoint's `dbQueries.max >= collectors.n1Threshold` THE
  SYSTEM SHALL emit exactly one diagnostic per such endpoint with rule
  `backend-doctor/runtime-possible-n1`, positioned at the `findings.json`
  path (line 1, column 1), and the F020 N+1 warning text as its message;
  WHEN no endpoint reaches the threshold THE SYSTEM SHALL emit no N+1
  diagnostics.
- **AC-6.** WHEN `findings.json` contains more rows than the probe's caps
  kept THE SYSTEM SHALL emit diagnostics only for rows present in
  `findings.json` (the events file is never read by scan).
- **AC-7.** WHEN a trace recorded no events worth a diagnostic (empty
  `blocking.calls`, no endpoint at threshold) THE SYSTEM SHALL emit zero
  runtime diagnostics and still add the `runtime` provenance block.

**Merge semantics**

- **AC-8.** WHEN runtime diagnostics are merged THE SYSTEM SHALL sort them
  into the single existing global order together with static diagnostics
  (target-relative path, line, column, rule id).
- **AC-9.** WHEN a runtime blocking-call site coincides with a static
  diagnostic at the same file/line THE SYSTEM SHALL keep both diagnostics.
- **AC-10.** WHEN `--scope changed|files|lines` is combined with `--trace` THE
  SYSTEM SHALL apply scope filtering to static diagnostics only and include
  all merged runtime diagnostics.
- **AC-11.** WHEN the merged report contains only warn-severity diagnostics
  (runtime or static) THE SYSTEM SHALL exit `0`; WHEN it also contains at
  least one static error-severity diagnostic THE SYSTEM SHALL exit `1`;
  runtime diagnostics SHALL always be severity `warn`.

**Report and reporters**

- **AC-12.** WHEN a trace is merged THE SYSTEM SHALL append
  `runtime: { sessionDir, traceSchemaVersion: 1 }` as the document's last key
  in `json` format; WHEN no trace is given THE SYSTEM SHALL omit the key.
- **AC-13.** WHEN format is `jsonl` THE SYSTEM SHALL emit one line per
  diagnostic including runtime ones, each with the pinned key construction
  order; WHEN format is `pretty` THE SYSTEM SHALL render runtime diagnostics
  through the existing diagnostic line format, add the one
  `Runtime trace: <sessionDir>` header line, and count them in the summary.
- **AC-14.** WHEN the same tree and the same `findings.json` are scanned
  twice THE SYSTEM SHALL produce byte-identical output for every format,
  including identical diagnostic ids.

**Config interplay**

- **AC-15.** WHEN a config names a `backend-doctor/runtime-*` id in `rules`
  or `ignore.rules` THE SYSTEM SHALL reject it as an unknown rule id
  (validation unchanged; the ids are report-level, not registered rules).

## Testing strategy (TDD)

- **Unit — `tests/unit/runtime/merge.test.ts`** (new; synthetic session
  directories written to temp dirs — `session.json` + `findings.json`, both
  tiny hand-written JSON; no committed fixture tree needed): every synthesis
  rule with exact diagnostic pins — blocking rows (relative path resolved
  against `session.cwd`, absolute kept, nulls → 1, message fields,
  tags/category/severity, target-relative id) (AC-4); N+1 at/below the
  threshold, message equality with the findings warning text, findings.json
  position (AC-5); cap honoring — diagnostics only for present rows (AC-6);
  zero-findings trace → zero diagnostics, provenance still added (AC-7);
  merged global sort with static diagnostics incl. `../`-relative
  out-of-root paths (AC-8); coexistence with a same-site static diagnostic
  (AC-9); provenance block appended last / absent without trace (AC-12);
  byte-identical re-merge for all three reporters (AC-14).
- **Unit — `tests/unit/runtime/load.test.ts`** (new, or a sibling describe in
  merge.test.ts): the AC-2 red paths with exact stderr reasons — directory
  absent/not a directory, findings.json missing/unparseable/wrong version,
  session.json missing/unparseable/wrong version — plus the happy load
  (AC-1).
- **Unit — extend `tests/unit/report.test.ts`**: `buildReport` carries the
  `runtime` block when the merge input says so and omits it otherwise
  (AC-12); `exitCodeFor` unchanged behavior re-pinned with runtime warns in
  the array (AC-11).
- **Unit — extend `tests/unit/reporters.test.ts`**: pretty renders a merged
  document (header line, `../`-prefixed diagnostic, summary count) (AC-13);
  jsonl emits runtime lines in construction order (AC-13).
- **e2e — `tests/e2e/combined-report.test.ts`** (new; `runCliAsync`, built
  bin): the full loop against the existing F020 fixtures —
  `probe -- node tests/fixtures/probe/prisma-app.cjs` into a temp `--out`,
  then `scan <fixture dir> --trace <session> --format json`: exit 0, stderr
  empty, the N+1 runtime diagnostic present with the exact message, the
  `runtime` block present, static diagnostics unaffected
  (AC-1/AC-5/AC-12/AC-13 CLI level). Red paths: `--trace` at a nonexistent
  dir and at a dir without findings.json → exit 2, empty stdout, stderr
  reason (AC-2). Absent flag → no `runtime` key in the JSON report (AC-3).
  A `--scope files` + `--trace` run proving runtime diagnostics survive scope
  filtering (AC-10).
- **Unit — extend `tests/unit/config/validate.test.ts`**: one case naming
  `backend-doctor/runtime-blocking-call` (and the N+1 id) in `rules` and in
  `ignore.rules` → rejected with the unknown-rule-id error (AC-15).
- **Existing-test consequences (recorded):** none for static-only paths —
  the flag is default-off and the report key conditional, so every current
  byte-pin holds.
- **Dependencies: none** [OQ-5]. No new fixtures under
  `tests/fixtures/<rule-id>/` (no registered rules added — constitution §3
  not triggered); no `docs/rules/` changes; the rule-docs gate is untouched.
- Build: no new entries — the merge ships inside the existing bin bundle.

## Open questions for review

All five were resolved on approval (2026-09-21) by adopting the
recommendations: (1) the merge lives in `scan --trace <session-dir>` — one
additive flag, no new command, no probe-side changes; (2) runtime diagnostics
are exactly blocking call sites and N+1 endpoints, derived from structured
findings, with `findings.warnings[]` never duplicated into the report; (3)
runtime diagnostics are always `warn` and never affect exit codes; (4) the
report document grows an additive optional `runtime` block and
`schemaVersion` stays `1`; (5) no new dependencies.

- **OQ-1 — where the merge lives (contract; user-owned).**
  Recommendation: **`scan --trace <session-dir>`** — one additive flag on the
  existing command; the scan already owns the report document, reporters, and
  exit codes, and the probe prints the session directory to copy-paste.
  Alternative A: a new `backend-doctor report` command merging a saved scan
  JSON + findings.json — keeps scan untouched but adds a command (§10 cost),
  a saved-report intermediate, and double parsing. Alternative B: probe-side
  merge — inverts the dependency (probe would need a static scan), and
  re-running probe to re-merge static findings is backwards.
- **OQ-2 — which findings become diagnostics (scope; user-owned).**
  Recommendation: **blocking call sites + N+1 endpoints only** — the two
  findings the runtime phase already gates (recording threshold /
  `n1Threshold`), and the only two kinds the PLAN's "merge runtime findings"
  wording covers without inventing new thresholds. Loop lag, memory peaks,
  GC, and endpoint latency stay numbers in `findings.json`; a "slow endpoint"
  or "lag p99 too high" diagnostic needs a threshold contract nobody approved
  (future work, F022-adjacent). Also covered here: `findings.warnings[]` (cap
  notices, no-attach warning) are **not** duplicated into the report — the
  findings document stays the record; a no-findings trace merges zero
  diagnostics with the provenance block still pointing at the session.
  Alternative: also map `findings.warnings` strings into diagnostics —
  noisier, stringly-typed, and double-reports every N+1.
- **OQ-3 — severity and exit-code semantics for runtime diagnostics
  (constitution §2/§5 implications; user-owned).** Recommendation: **always
  `warn`, never exit-code-affecting** — carries the F018–F020 "findings never
  influence exit codes" precedent into the merged report; measured runtime
  values vary per run, so failing CI on them without a tuning surface would
  violate the precision budget's spirit (§2). Escalation requires
  config-tunable runtime rules (registered ids, docs, fixtures per §3) — a
  heavier contract explicitly out of scope today. Alternative: let runtime
  findings be errors — makes the combined report CI-blocking without any way
  to silence a noisy endpoint, which §2 forbids in spirit.
- **OQ-4 — report document growth (contract; user-owned).** Recommendation:
  **additive optional `runtime` block, `schemaVersion` stays `1`** — the
  F019/F020 precedent (new sections/fields are additions within a version);
  consumers that branch on the version are unaffected, and without `--trace`
  the document is byte-identical to today's. Alternative: bump
  `schemaVersion` to 2 — defensible for any shape change, but this one is
  purely additive and conditional, so a bump would force every consumer to
  migrate for nothing.
- **OQ-5 — dependencies.** Recommendation: **none** — findings.json parsing,
  diagnostics, and reporters are all existing machinery; no npm packages are
  involved.
