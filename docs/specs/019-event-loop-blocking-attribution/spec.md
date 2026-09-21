# Spec 019 — Event loop & blocking attribution (F019)

- **Status:** Draft — pending review
- **Phase:** 5 — Runtime engine
- **Depends on:** F018 Runtime probe runner (Done — session directory layout,
  `NODE_OPTIONS` hook injection, `events.ndjson` NDJSON discipline,
  `runCliAsync` e2e helper)
- **Blocks:** F020 HTTP runtime tracing (reuses the async-context tags and the
  collector event stream), F021 Combined report (consumes `findings.json`),
  F022 Eval corpus (owns the probe check on a deliberately blocking app)

## Problem

F018 delivered the probe pipe — spawn, session storage, lifecycle events — but a
trace of `probe.attach`/`probe.detach` says nothing about what the app actually
did. The PLAN's Phase 5 promise is attribution: "handler X blocked the loop for
Nms, culprit: users.service.ts:42". The static blocking rules (F006) can only
*suspect* blocking calls in source; a probe session can *prove* them on a real
run. F019 adds the collectors (event-loop delay monitor, sync-blocking-API
instrumentation, async-context tagging) inside the existing preload hook, and a
deterministic analysis step in the probe parent that turns the recorded events
into a `findings.json` in the session directory. No new commands, flags, rules,
or dependencies.

## Goals

- G1. **Loop-lag collector** — inside the hook, when a probe session is active:
  `perf_hooks.monitorEventLoopDelay` feeds periodic `loop.lag` window events
  (count, p50/p99/max per window) plus a cumulative final flush written before
  the process's `probe.detach` line. The interval timer is unref'd; the
  histogram never keeps the host alive.
- G2. **Blocking-call collector** — inside the hook: the sync blocking APIs of
  node core (fs `*Sync`, sync crypto, sync child_process, sync zlib — exact
  list in design.md) are wrapped; a call taking ≥ `blockThresholdMs` (default
  20) records a `block.call` event with the API name, the duration, and the
  culprit `file:line:column` + enclosing function name from a stack captured at
  call entry. Attribution covers CJS and ESM callers alike (verified: core
  modules are singletons shared between `require` and `import`).
- G3. **Async-context tagging** — inside the hook: an `async_hooks` hook
  maintains a bounded `asyncId → { type, triggerAsyncId }` map; each
  `block.call` carries the executing resource's type and its trigger-chain root
  type (e.g. `PROMISE`/`TIMER`/`SERVER`) — a cheap "in request path" grouping
  signal. Real request-name correlation is F020's HTTP tracing.
- G4. **Filter enforcement** — the recorded `--filter` globs (session
  metadata in F018) now actually restrict collection: a `block.call` is
  recorded only when its culprit file matches at least one glob. `loop.lag` and
  lifecycle events are unaffected (F018 contract: lifecycle always recorded).
  Matching uses picomatch (already a runtime dependency), bundled into the hook
  build — no new dependencies.
- G5. **Deterministic analysis at finalize** — after the child exits, the probe
  parent reads `events.ndjson`, runs a pure analysis (same events file →
  byte-identical output), writes `findings.json` into the session directory,
  and prints a one-line summary to stderr. When no `probe.attach` was recorded
  (the target was not Node, or the hook did not load), findings are zero-state
  and the parent says so loudly on stderr.
- G6. **Contracts stay additive** — `traceSchemaVersion` stays `1`; the new
  event types and `findings.json` are additions within it. `session.json`'s
  key set, CLI flags (none added), exit codes, stdout purity, and the static
  report are untouched. Collector tuning is environment-variable plumbing, not
  CLI surface.

## Non-goals

- **HTTP runtime tracing** (endpoint latency, per-request handler names, DB
  query counts, memory/GC signals) — F020. F019's `function` field is the
  enclosing JS function name from the stack, not an HTTP handler identity.
- **Combined report** (merging runtime findings with static diagnostics,
  `runtime` tag, reporter changes) — F021. Findings never influence probe exit
  codes.
- **CPU sampling profiler** (V8/inspector) for CPU-bound loops without sync
  calls — not in any current PLAN line. Known recall hole, documented: a pure
  spin loop produces `loop.lag` windows but no `block.call`; native blockers
  (e.g. better-sqlite3) are likewise invisible.
- **worker_threads coverage** — whether the preload runs inside workers is not
  relied upon; blocking inside workers is out of scope.
- **Third-party module instrumentation** (express, prisma internals) — F020+.
- **CLI flags for collector knobs** — env-var tuning only in this feature; a
  flag would be new surface (constitution §10) for a value nobody has tuned yet.
- **Trace redaction beyond the F018 posture** — findings contain file paths;
  they stay local under the session directory (constitution §9).
- **Reporters/UI for traces** (flamegraphs, viewers) — no feature line.
- **Windows-specific behavior** — POSIX-first like the rest of the toolchain.

## User stories

1. **Backend developer** — she runs `backend-doctor probe --duration 60 -- npm
   run dev`, exercises her endpoints, and at shutdown stderr reports e.g.
   `findings: 5 blocking call(s) ≥ 20ms (total 312ms); top: fs.readFileSync at
   src/users.service.ts:42 (3×, 210ms)` alongside the trace location. She opens
   `findings.json` for the full aggregation and lag percentiles.
2. **CI author** — probe exit codes are unchanged (child pass-through, 2 usage,
   128+signum); `findings.json` is a versioned machine-readable file at a
   documented path inside the session directory; the summary is stderr-only;
   probe's stdout stays empty on every path.
3. **AI agent** — the agent reads `findings.json` (stable key sets, fixed
   aggregation ordering, deterministic bytes for a given events file) and
   `events.ndjson` (NDJSON discipline, additive event types). Unknown event
   types and unknown fields are ignorable by construction; the trace contract
   version it branches on is still `traceSchemaVersion: 1`.

## Contract / Model

Parts marked **[OQ-n]** are gated on the open questions; the text below states
the recommended shape.

### CLI surface — unchanged

```
backend-doctor probe [--duration <seconds>] [--out <dir>] [--filter <glob>]... -- <command> [args...]
```

No new flags. Collector tuning is environment (validated by the parent **before
spawn**; invalid → usage error, exit 2, no session directory):

- `BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS` — minimum sync-call duration to
  record, default `20`; must be a positive finite number.
- `BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS` — lag window period, default `1000`;
  must be a finite number ≥ 50.

The parent normalizes both into one injection env var and passes the filter
set through a second one (internal plumbing, mirror of
`BACKEND_DOCTOR_PROBE_EVENTS`):

- `BACKEND_DOCTOR_PROBE_COLLECTORS` — JSON
  `{"blockThresholdMs":<n>,"lagIntervalMs":<n>}`; present in every probe
  session; **its presence is what activates the collectors** in the hook.
- `BACKEND_DOCTOR_PROBE_FILTERS` — JSON array of the `--filter` globs, exactly
  `session.filters`; absent/empty = no restriction.

The sensitivity warning gains one clause stating that the probe instruments
synchronous APIs and monitors the event loop (small overhead). All F018-pinned
warning fragments remain (message wording is ours per AGENTS.md; the change is
flagged here for review visibility).

### Session directory layout — additive

```
<out>/<session-id>/
├─ session.json    unchanged — exact F018 key set, still written once at finalize
├─ events.ndjson   lifecycle events + new collector event types (below)
└─ findings.json   NEW — written at finalize by the probe parent
```

### `events.ndjson` — new event types (additive within `traceSchemaVersion: 1`)

Every event keeps the F018 envelope: `type`, `timestamp` (ISO-8601 UTC),
`pid`. Consumers must ignore unknown types/fields; `probe.attach` gains one
optional `collectors` block (`{"blockThresholdMs":n,"lagIntervalMs":n}`,
present when collectors are active in that process).

`block.call` — one per instrumented sync call with `durationMs ≥
blockThresholdMs`:

```json
{"type": "block.call", "timestamp": "…", "pid": 123,
 "api": "fs.readFileSync", "durationMs": 87.4,
 "file": "src/users.service.ts", "line": 42, "column": 15,
 "function": "UsersService.findAll",
 "async": {"type": "PROMISE", "rootType": "SERVER"}}
```

- **Attribution rule:** the stack is captured at call entry (cheap
  `Error.captureStackTrace` into a holder, formatted only when the call turns
  out slow; `Error.prepareStackTrace` is set and restored synchronously — never
  left patched). The culprit is the first frame outside node internals **and**
  `node_modules`; if none exists, the first frame outside node internals
  (library fallback). `file` is relative to the process cwd when the frame is
  under it, absolute otherwise. `function` is the V8 frame's function name or
  `null`. `async` is absent when tagging is unavailable.
- `async.type` / `async.rootType` come from the `async_hooks` map (executing
  resource; root of its `triggerAsyncId` chain, bounded walk).

`loop.lag` — one per closed window plus a final flush:

```json
{"type": "loop.lag", "timestamp": "…", "pid": 123, "periodMs": 1000,
 "count": 119, "p50Ms": 0.2, "p99Ms": 4.1, "maxMs": 31.7, "final": false,
 "total": {"count": 1420, "p50Ms": 0.3, "p99Ms": 5.2, "maxMs": 41.7}}
```

- Window stats cover the closed window (histogram reset after each); `total`
  is the process-cumulative histogram (never reset), present on every `loop.lag`
  event. `final: true` marks the flush written at process end.
- **Ordering guarantee:** a process writes its `final` `loop.lag` flush before
  its `probe.detach` line.

### `findings.json` — new file, written once at finalize [OQ-3]

```json
{
  "traceSchemaVersion": 1,
  "sessionId": "20260921T101530Z-ab12cd",
  "collectors": {"blockThresholdMs": 20, "lagIntervalMs": 1000},
  "loopLag": {"windows": 12, "count": 1420, "p50Ms": 0.3, "p99Ms": 5.2, "maxMs": 41.7},
  "blocking": {
    "count": 5,
    "totalMs": 312.4,
    "calls": [
      {"api": "fs.readFileSync", "count": 3, "totalMs": 210.2, "maxMs": 120.1,
       "file": "src/users.service.ts", "line": 42, "column": 15,
       "function": "UsersService.findAll", "asyncRootType": "SERVER"}
    ]
  },
  "events": {"lines": 57, "malformedLines": 0, "attachProcesses": 1},
  "warnings": []
}
```

- `blocking.count` / `blocking.totalMs` cover **all** analyzed `block.call`
  events; `calls` aggregates them grouped by `(api, file, line, column,
  function, asyncRootType)` — the same site under different async roots is
  deliberately different rows — sorted by `totalMs` desc, tie-break `file` asc
  then `line` asc, capped at the top 50 groups (a cap appends
  `"blocking calls capped at 50 groups"` to `warnings`).
- `loopLag` merges every `loop.lag` event across processes: `windows` and
  `count` are exact sums, `maxMs` is the exact max, `p50`/`p99` are
  count-weighted averages (percentiles cannot be merged exactly across
  processes/windows — documented approximation, deterministic).
- `events.malformedLines` counts non-JSON lines (skipped, never fatal);
  `attachProcesses` counts distinct `probe.attach` pids.
- `warnings` also carries `"no probe events recorded — the target may not be
  Node or the hook did not load"` when `attachProcesses` is 0; that warning is
  echoed to stderr as well.
- Zero states are structural (`calls: []`, `windows: 0`, zeros), never omitted
  keys.
- Determinism: analysis is a pure function of `events.ndjson` + session id +
  collector settings; the same inputs produce byte-identical `findings.json`
  (values inside vary between runs by nature — F018's constitution §1 note
  extends to this file).
- Analysis covers events present at finalize (direct-child exit, F018
  semantics); a descendant outliving the child is not waited for.

### Hook discipline (extends F018's)

- Collectors are active **only** when `BACKEND_DOCTOR_PROBE_COLLECTORS` is
  present and valid; otherwise the hook behaves exactly as F018 (lifecycle
  events only, inert-with-notice outside a session). Observable inertness:
  instrumented core functions remain native.
- A collector that fails to install or throws records one stderr notice and
  disables itself; the host app is never affected (constitution §7), and
  already-recorded events remain valid (constitution §8 spirit, F018's
  inert-on-write-failure pattern).
- The hook's own event writes are never recorded as blocking calls
  (re-entrancy guard), and hook-bundle frames are never culprits.
- Wrappers preserve the original function's `name` and pass through `this`,
  arguments, return values, and throws unchanged.

### Constitution notes

- §1 (deterministic): static analysis untouched; findings analysis is pure and
  byte-stable for identical events; sampled runtime values vary per run (F018
  carve-out, extended to `findings.json`).
- §5 (stable contracts): everything additive — no flag, config field, exit
  code, report-schema, or `schemaVersion` change; `session.json` byte-shape
  frozen; new event types and `findings.json` join the versioned trace
  contract.
- §7 (zero intrusion): preload-only; no user file read for modification or
  written; timers unref'd; `Error.prepareStackTrace` never left patched.
- §8 (fail loud): stderr summary on every finalize; no-attach case warned in
  findings **and** on stderr; malformed event lines counted, not dropped
  silently; collector failures notice once.
- §9 (local-first): nothing leaves the machine; the mandatory warning already
  covers the session.
- §10 (small surface): zero new commands, zero new flags.

## EARS acceptance criteria

**Collectors (hook side)**

- **AC-1.** WHEN a process runs with collectors active THE SYSTEM SHALL record
  a `loop.lag` event with `"final": true` and a `total` block before that
  process's `probe.detach` event, and its `probe.attach` event SHALL carry the
  `collectors` block with the active threshold and interval.
- **AC-2.** WHEN a session outlasts the lag interval THE SYSTEM SHALL record
  periodic non-final `loop.lag` window events, each with `count`, `p50Ms`,
  `p99Ms`, `maxMs` for its window.
- **AC-3.** WHEN an instrumented sync API call from the target takes ≥
  `blockThresholdMs` THE SYSTEM SHALL record one `block.call` event with `api`,
  `durationMs` ≥ threshold, `file`/`line`/`column`/`function` per the
  attribution rule, and `async` type/rootType when tagging is available.
- **AC-4.** WHEN the blocking call site is reached through a CJS `require` or
  an ESM named import THE SYSTEM SHALL attribute both identically.
- **AC-5.** WHEN the hook loads without the probe session environment THE
  SYSTEM SHALL leave instrumented core functions native, record no collector
  events, and behave exactly as in F018 (one notice, inert).
- **AC-6.** WHEN blocking events are recorded THE SYSTEM SHALL never attribute
  a culprit to the hook bundle itself or to a node-internal frame, and SHALL
  not record the hook's own event writes as blocking calls.
- **AC-7.** WHEN `--filter` globs are recorded for the session THE SYSTEM SHALL
  record `block.call` events only for culprit files matching at least one glob,
  and SHALL record `loop.lag` and lifecycle events regardless of filters.

**Analysis (probe parent at finalize)**

- **AC-8.** WHEN the child exits THE SYSTEM SHALL write `findings.json` into
  the session directory with exactly the structure specified in Contract
  (top-level key set, zero states as structural values).
- **AC-9.** WHEN `block.call` events exist THE SYSTEM SHALL aggregate them into
  `blocking.calls` grouped by `(api, file, line, column, function,
  asyncRootType)`, sorted by `totalMs` desc with `file` asc then `line` asc
  tie-breaks, capped at 50 groups with a `warnings` entry when capped.
- **AC-10.** WHEN `events.ndjson` contains no `probe.attach` event THE SYSTEM
  SHALL write a zero-state `findings.json` whose `warnings` names the
  no-attach cause, echo that warning to stderr, and finalize the session
  normally.
- **AC-11.** WHEN `events.ndjson` contains a malformed line THE SYSTEM SHALL
  skip it, count it in `events.malformedLines`, and analyze the remaining
  lines.
- **AC-12.** WHEN a session finalizes THE SYSTEM SHALL print one stderr summary
  line naming `findings.json` with the blocking count and lag p99, and SHALL
  write nothing of its own to probe stdout.

**Discipline**

- **AC-13.** WHEN findings are produced THE SYSTEM SHALL NOT change probe exit
  codes (F018 pass-through/2/128+signum semantics) and SHALL leave
  `session.json` byte-shape-identical to the F018 contract.
- **AC-14.** WHEN a collector fails to install or throws inside the host THE
  SYSTEM SHALL disable that collector after one stderr notice and leave the
  host app running unaffected.
- **AC-15.** WHEN the probe parent's environment contains an invalid
  collector knob (non-numeric, non-positive threshold, or interval below 50)
  THE SYSTEM SHALL exit `2` with the reason on stderr before spawning, leaving
  no session directory.
- **AC-16.** WHEN the same `events.ndjson` is analyzed twice THE SYSTEM SHALL
  produce byte-identical `findings.json`.

## Testing strategy (TDD)

- **Unit — `tests/unit/probe/analysis.test.ts`** (pure, inline synthetic
  events, no committed fixture tree): findings structure and zero states
  (AC-8); aggregation, ordering, tie-breaks, cap+warning (AC-9); no-attach
  zero-state and warning (AC-10); malformed-line counting (AC-11);
  byte-identical re-analysis (AC-16); loopLag merge rules (exact max/count,
  weighted p50/p99).
- **Unit — `tests/unit/probe/options.test.ts`** (extends): knob parsing red
  paths — empty, NaN, negative, sub-50 interval (AC-15).
- **Hook integration — `tests/unit/probe/hook.test.ts`** (extends; built
  `register.cjs` via `spawnSync`, F018 pattern). New fixtures under
  `tests/fixtures/probe/`, plain `.js`/`.mjs` run by plain `node`:
  - `blocking.cjs` — CJS: `crypto.pbkdf2Sync` (high iterations, reliably slow)
    + a `readFileSync` of a multi-MB file the test pre-creates in the tmp cwd
    (path via argv).
  - `blocking.mjs` — same operations through ESM named imports (AC-4).
  - `spin.js` — runs ~1.5s with periodic `pbkdf2Sync` bursts (AC-2, e2e lag
    windows).
  - Assertions: `block.call` recorded with `api: "crypto.pbkdf2Sync"`,
    culprit file = the fixture, `durationMs` ≥ threshold (knob set low, e.g.
    10) (AC-3); ESM fixture yields the same shape (AC-4); without session env
    `require("node:fs").readFileSync.toString()` contains `[native code]`,
    with collectors active it does not (AC-5); final `loop.lag` precedes
    `probe.detach`, attach carries `collectors` (AC-1); no event's culprit
    path is under `dist/probe/` or `node:` (AC-6); `BACKEND_DOCTOR_PROBE_FILTERS`
    set to a non-matching glob suppresses `block.call` while lag/lifecycle
    still record (AC-7, hook level); malformed `BACKEND_DOCTOR_PROBE_COLLECTORS`
    JSON → one notice, lifecycle-only (AC-14 hook level).
- **e2e — `tests/e2e/probe.test.ts`** (extends; `runCliAsync`):
  - `probe -- node blocking.cjs` (threshold knob 1): exit pass-through 0,
    stdout empty, `findings.json` exists with the Contract key set, top call
    file ends with `blocking.cjs`, stderr summary names findings.json
    (AC-8/AC-12); `session.json` key set asserted with the existing
    `assertCommonSession` (AC-13); `fail.js` still exits 3 (AC-13).
  - `probe --filter 'vendor/**' -- node blocking.cjs`: `blocking.count === 0`,
    lag data present (AC-7 CLI level).
  - `probe -- sh -c "echo not-node"`: exit 0, findings zero-state,
    no-attach warning on stderr (AC-10).
  - invalid knob env: exit 2, no session dir, empty stdout (AC-15).
  - `spin.js` with `--duration` and a small interval knob: ≥ 2 non-final
    `loop.lag` windows (AC-2 CLI level).
- **Existing tests updated (recorded consequence):** the four
  `expect(events).toHaveLength(2)` pins (three in `hook.test.ts`, one in
  `probe.test.ts`) become bracket assertions — `probe.attach` first,
  `probe.detach` last, bracket pids equal — because final `loop.lag` flushes
  legitimately join the stream. This spec is the recorded justification.
- No new rules, no `tests/fixtures/<rule-id>/` trees, no `docs/rules/`
  changes; rule-docs gate untouched. Timing values are excluded from
  assertions except ≥ threshold bounds; long paths keep 30s timeouts (F018
  precedent).
- Build: no new entries — the hook entry already rebuilds on every test run via
  the array-aware `globalSetup`; `findings.json` analysis ships inside the
  existing bin bundle.

## Open questions for review

- **OQ-1 — collector knobs: env vars vs CLI flags vs hardcoded constants.**
  Recommendation: env vars validated by the parent (invalid → exit 2 before
  spawn), defaults `blockThresholdMs: 20`, `lagIntervalMs: 1000`; no new CLI
  flags this feature (§10). Alternatives: two new flags (discoverable but new
  surface nobody has asked to tune yet) or hardcoding (simplest, but tests
  wait full seconds and real sessions cannot be tuned at all).
- **OQ-2 — attribution mechanism: sync-API instrumentation vs sampling
  profiler.** Recommendation: wrap known sync blocking APIs of node core —
  deterministic `file:line` attribution, zero intrusion, mirrors the static
  blocking rules' story; documented recall holes (CPU spin loops, native
  modules, workers) remain visible through `loop.lag` only. Alternative: V8
  inspector sampling profiler — catches everything but is far more intrusive
  and complex, and is not in any PLAN line.
- **OQ-3 — `findings.json` versioning axis.** Recommendation: reuse
  `traceSchemaVersion` (stays `1`; this feature is additive within v1) — one
  version axis for the whole trace family, consumers branch once. Alternative:
  a separate `findingsSchemaVersion`, which buys nothing today and adds a
  second number consumers must track.
- **OQ-4 — async_hooks tagging depth.** Recommendation: bounded
  `asyncId → { type, triggerAsyncId }` map (no per-resource stacks), each
  `block.call` tagged with executing type + trigger-chain root type. Full
  per-resource stack registries (APM-grade, memory-heavy) and request-name
  correlation are F020's HTTP tracing territory.
- **OQ-5 — dependencies.** Recommendation: none. `picomatch` is already a
  runtime dependency (bundled into the hook build); everything else is node
  core (`perf_hooks`, `async_hooks`).
