# Spec 018 — Runtime probe runner (F018)

- **Status:** Draft — pending review
- **Phase:** 5 — Runtime engine
- **Depends on:** F001 CLI skeleton (Done — `run.ts` command wiring, exit-code
  discipline, stdout/stderr purity), F017 Agent integration (Done — the
  `runCliAsync` e2e helper exists for tests that manage child processes)
- **Blocks:** F019 Event loop & blocking attribution, F020 HTTP runtime tracing,
  F021 Combined report (all consume the probe session + trace files), F022 Eval
  corpus (owns the "probe check on a bad app" gate)

## Problem

Phase 5 starts here. Everything shipped so far is static: the tool cannot see what a
running backend actually does. The PLAN mandates the runtime engine as the analog of
`react-doctor scan <url>`, but for a Node process, under the constitution's
zero-intrusion rule (§7): the app must start via `backend-doctor probe -- <start
command>` with a preload hook, with no changes to user code, build config, or
runtime. None of that machinery exists — there is no `probe` command (the name is
constitution-reserved, §10), no hook injection, no session concept, no local trace
storage. F018 delivers the runner: an instrumented run of the target app, a bounded
profiling session (duration/filters), traces stored locally, and the data-sensitivity
warning. The collectors that make the trace analytically interesting are explicitly
later features (F019/F020); F018 is the pipe they flow through.

## Goals

- G1. New CLI command `backend-doctor probe -- <command...>`: spawn the user's start
  command as a child process in the current working directory, with the probe hook
  preloaded into it (and any node descendants) via `NODE_OPTIONS="--require <hook>"`,
  merged with any preexisting `NODE_OPTIONS`. Zero intrusion: no user file is read
  for modification or written, child stdin/stdout/stderr are inherited unchanged.
- G2. The probe hook (shipped inside the package, loaded via `--require`) records
  lifecycle events to the session's `events.ndjson`: `probe.attach` when a process
  loads the hook, `probe.detach` when that process exits. Collector events from
  F019/F020 land in the same file later. The hook never crashes the host app and is
  inert when the session env is absent.
- G3. Profiling session: a session directory holds `session.json` (versioned
  metadata: session id, start/end timestamps, command argv, cwd, node/platform/arch,
  pid, requested duration, filters, how the child ended) and `events.ndjson`
  (newline-delimited JSON, one event per line). `--duration <seconds>` bounds the
  session; `--out <dir>` relocates the storage root; `--filter <glob>` (repeatable)
  is recorded as session metadata with collector-restriction semantics.
- G4. Traces stay local (constitution §9): everything is written under the session
  directory on disk; no network calls anywhere in the probe path; before the child
  starts, a data-sensitivity warning is printed to stderr (what a trace may contain,
  where it is stored, that it is never sent anywhere, and a gitignore hint).
- G5. Signal and lifetime discipline: the probe forwards SIGINT/SIGTERM to the child,
  finalizes the session on every exit path (child exit, duration expiry, signal), and
  its exit code follows the semantics proposed in OQ-1.
- G6. No new dependencies; no changes to `scan`, config, reporters, rules, or the
  static report contract. The shipped CLI grows exactly the one constitution-reserved
  top-level command `probe`.

## Non-goals

- **Event-loop lag and blocking attribution** (`perf_hooks.monitorEventLoopDelay`,
  `async_hooks`, `file:line` culprits) — F019 owns all collectors of this kind.
- **HTTP runtime tracing** (endpoint latency, DB query counts, N+1 at runtime,
  memory/GC signals) — F020.
- **Combined report** (merging runtime findings with static ones, `runtime` tag,
  reporter changes) — F021.
- **Any analysis or diagnostics in F018** — the probe emits no `Diagnostic`s; exit
  code 1 under the scan semantics does not apply (OQ-1 defines probe semantics).
- **Trace redaction/scrubbing of captured payloads** — no payload capture exists
  yet; redaction policy arrives with the collectors that capture payloads.
- **Probe settings in the config file** (a `probe` config section) — flags only in
  F018; the probe deliberately does not load `backend-doctor.config.ts` (its fields
  are about static rules; constitution §10).
- **Engine v2 / oxc-parser migration** — a separate in-phase PLAN line.
- **Remote storage, telemetry, trace uploading** — forbidden by constitution §9 for
  MVP; no feature line proposes them.
- **Windows-specific `NODE_OPTIONS` length quirks, shell-mode spawning, PTY
  handling** — the probe spawns the command directly (no shell); POSIX-first like
  the rest of the toolchain.

## User stories

1. **Backend developer** — she runs `backend-doctor probe --duration 60 -- npm run
   dev`, reads the warning, exercises her endpoints for a minute, and the probe shuts
   the dev server down at the window's end, leaving `.backend-doctor/probe/<session>/`
   with the recorded session. Her app's own console output looked exactly as usual
   (inherited stdio), and nothing was sent anywhere.
2. **CI author** — in F018 probe is not a CI surface (no diagnostics, no report,
   `blocking` does not apply). She is unaffected; if she scripts it, bounded runs
   (`--duration`) plus the pass-through exit code make it usable as a smoke check.
3. **AI agent** — the agent can safely ignore probe in F018: nothing is written to
   probe's stdout, so it cannot confuse stdout-parsing consumers. The trace contract
   (`traceSchemaVersion`, NDJSON line discipline) is pinned by tests from day one, so
   F019+ tooling and agents reading session files later can branch on the version.

## Contract / Model

Parts marked **[OQ-n]** are gated on the open questions; the text below states the
recommended shape.

### CLI surface (additive; `scan`/`init`/`rules`/`ci` untouched)

```
backend-doctor probe [--duration <seconds>] [--out <dir>] [--filter <glob>]... -- <command> [args...]

  Start <command> with the probe hook preloaded via NODE_OPTIONS; record a
  profiling session; write traces locally; print the sensitivity warning to
  stderr before the child starts; forward SIGINT/SIGTERM to the child.

  --duration <seconds>  cap the session; when it expires while the child still
                        runs, request shutdown (graceful escalation), record how
                        the child ended, finalize. Default: unbounded — the
                        session ends when the child exits.
  --out <dir>           storage root; the session directory is created inside it.
                        Default: ./.backend-doctor/probe
  --filter <glob>       repeatable; recorded into session metadata as the
                        collector-restriction set (which file paths future
                        collector events may cover). Lifecycle events (attach /
                        detach) are always recorded. [OQ-3]
```

Usage/environment errors exit `2` with the reason on stderr and spawn nothing:
no `--` command, empty command after `--`, non-numeric or non-positive
`--duration`, `--out` pointing at an existing non-directory, or the hook preload
file missing from the installation. All other exit behavior is OQ-1's contract.

Probe never writes to its own stdout (the child inherits stdout directly, so the
app's output reaches the terminal byte-identical); probe notices — the sensitivity
warning, the session summary, error reasons — go to stderr.

### Session directory layout (new, versioned contract — OQ-2)

```
<out>/<session-id>/
├─ session.json    written once at finalize by the probe parent
└─ events.ndjson   created empty at session start; appended by hook processes
```

- `session-id`: `<YYYYMMDDTHHMMSSZ>-<random>` (UTC stamp + `mkdtemp` suffix).
  Runtime identifiers are deliberately timestamped; see constitution notes.
- `session.json`:

```json
{
  "traceSchemaVersion": 1,
  "session": {
    "id": "20260921T101530Z-ab12cd",
    "startedAt": "2026-09-21T10:15:30.123Z",
    "endedAt": "2026-09-21T10:15:31.456Z",
    "command": ["npm", "run", "dev"],
    "cwd": "/repo/apps/api",
    "node": { "version": "v22.10.0", "platform": "darwin", "arch": "arm64" },
    "pid": 1234,
    "duration": { "requestedSeconds": 60, "effectiveMs": 1333 },
    "filters": ["**/src/**"],
    "exit": { "code": 0 }
  }
}
```

  `exit` is `{ "code": <number> }` or `{ "signal": "<name>" }`. `pid` is the direct
  child's pid. `duration.effectiveMs` is the wall time from spawn to child end.
- `events.ndjson`: one JSON object per line, in write order (spec 017 pinned the
  NDJSON discipline for jsonl; the same rules apply here). Each event has at least:

```json
{"type": "probe.attach", "timestamp": "2026-09-21T10:15:30.200Z", "pid": 1234,
 "ppid": 1233, "nodeVersion": "v22.10.0", "argv": ["npm", "run", "dev"]}
{"type": "probe.detach", "timestamp": "2026-09-21T10:15:31.400Z", "pid": 1234,
 "reason": "exit", "code": 0}
```

  Because preload propagates through `NODE_OPTIONS`, descendant node processes
  (e.g. under `npm run`) attach too; every event carries its own `pid`, and
  per-line `O_APPEND` writes keep concurrent appends line-atomic on POSIX.
  `detach.reason` is `"exit" | "signal"`.

### Probe hook (ships inside the package)

Built as a dedicated CommonJS entry (`dist/probe/register.cjs`) so `--require`
works across the full supported engine range (Node 20 cannot `require()` ESM at
all; require-ESM is only reliably available from Node ≥ 22.12). The hook reads its
session file path from a probe-set environment variable; when the variable is
absent (the hook was attached manually, outside a probe session) it writes one
stderr notice and stays inert — it must never crash the host app (constitution §8
applies to our reporting, not to breaking the user's process). The hook itself
performs no analysis and no network I/O.

### Constitution notes

- §1 (deterministic): static analysis is untouched. Runtime traces are facts about
  a real execution: timestamps, durations and session ids necessarily vary between
  runs. What F018 pins deterministically is the trace *shape* — schemas, key sets,
  NDJSON line discipline — not the sampled values. This is a conscious,
  documented carve-out (the constitution's determinism clause governs analysis
  output, and the probe performs no analysis), not a constitution amendment.
- §5 (stable contracts): additive CLI growth; `scan` flags, config fields, report
  schema, `schemaVersion` and its 0/1/2 exit semantics untouched. The trace format
  is a **new** contract, versioned by its own `traceSchemaVersion` from day one
  (OQ-2).
- §7 (zero intrusion): injection is a `NODE_OPTIONS` preload; no user file is
  edited; child stdios are inherited.
- §8 (fail loud): usage/environment errors exit `2` with a reason; the hook is
  inert-with-notice outside a session; a session is finalized on every exit path,
  and `session.json` records how the child actually ended.
- §9 (local-first): everything stays under the session directory; the sensitivity
  warning is mandatory on every session start.
- §10 (small, boring surface): one new command — the constitution-reserved
  `probe` — three flags.

## EARS acceptance criteria

**Instrumented run**

- **AC-1.** WHEN `probe` runs with a valid command after `--` THE SYSTEM SHALL
  spawn that command (without a shell) in the probe's cwd with the probe hook
  preloaded via `NODE_OPTIONS`, SHALL preserve any preexisting `NODE_OPTIONS`
  value alongside the appended `--require` directive, SHALL inherit the child's
  stdin/stdout/stderr, and SHALL exit with the child's exit code once the child
  exits (OQ-1).
- **AC-2.** WHEN the target app writes to stdout THE SYSTEM SHALL pass those bytes
  through unchanged, and THE SYSTEM SHALL write nothing of its own to probe's
  stdout on any path (success, usage error, or signal).
- **AC-3.** WHEN a session starts THE SYSTEM SHALL write to stderr, before the
  child spawns, a warning that states the trace may contain URLs, file paths and
  other request data, names the session directory, states traces stay local and
  are never sent anywhere, and hints at gitignoring the storage directory.

**Session storage**

- **AC-4.** WHEN a session finalizes THE SYSTEM SHALL have created
  `<out>/<session-id>/` containing `session.json` with `traceSchemaVersion: 1` and
  the session block (id, startedAt, endedAt, command, cwd, node/platform/arch,
  pid, duration, filters, exit) exactly as specified in Contract, and
  `events.ndjson` containing at least one `probe.attach` and one `probe.detach`
  event for the direct child, in that order.
- **AC-5.** WHEN no `--out` is given THE SYSTEM SHALL create the session under
  `<cwd>/.backend-doctor/probe/<session-id>/`; WHEN `--out <dir>` is given THE
  SYSTEM SHALL create the session inside `<dir>`.
- **AC-6.** WHEN the probe runs twice THE SYSTEM SHALL create two distinct session
  directories (unique session ids).

**Duration, signals, lifetime**

- **AC-7.** WHEN `--duration <seconds>` is set and the child is still running at
  expiry THE SYSTEM SHALL request shutdown via graceful escalation (SIGINT, then
  SIGTERM, then SIGKILL at fixed grace intervals), record how the child ended in
  `session.json`, finalize the session, and exit per OQ-1.
- **AC-8.** WHEN the probe receives SIGINT or SIGTERM while the child runs THE
  SYSTEM SHALL forward the signal to the child, finalize the session, and exit
  `128 + <signal number>` (OQ-1).
- **AC-9.** WHEN the child exits on its own with code N THE SYSTEM SHALL exit N
  (pass-through), with the session finalized and `session.json` recording
  `"exit": { "code": N }`.

**Usage and environment errors (all: exit 2, reason on stderr, nothing on stdout,
no session directory created, child not spawned)**

- **AC-10.** WHEN `probe` runs without a `--` command, or with an empty command
  after `--`, or with a non-numeric or non-positive `--duration`, or with `--out`
  pointing at an existing non-directory, or when the hook preload file is missing
  from the installation, THE SYSTEM SHALL exit `2`, write the reason to stderr,
  and spawn nothing.

**Hook discipline**

- **AC-11.** WHEN events are written THE SYSTEM SHALL append newline-delimited
  JSON, one object per line, each line parsing as an object with at least `type`,
  `timestamp` (ISO-8601 UTC) and `pid`; WHEN a process loads the hook without the
  probe session environment variable THE SYSTEM SHALL write one stderr notice,
  write no events, and let the host process run to its normal end unaffected.
- **AC-12.** WHEN a descendant node process starts under the session (preload
  inherited through `NODE_OPTIONS`) THE SYSTEM SHALL record its `probe.attach`
  (and later its `probe.detach`) with that process's own `pid` in the same
  `events.ndjson`.

## Testing strategy (TDD)

- **Unit — `tests/unit/probe/session.test.ts`**: session-id format and uniqueness
  (AC-6); duration option parsing/validation (AC-10 red paths); `NODE_OPTIONS`
  merge builder — absent env, existing env (AC-1 unit level); default/`--out`
  storage-root resolution including the existing-file error (AC-5, AC-10);
  `session.json` builder — exact key set, `traceSchemaVersion: 1`, both `exit`
  variants (AC-4); event-line validation helper (AC-11).
- **Integration — the built hook**: `node --require dist/probe/register.cjs
  <script>` without probe env — script runs normally, no events file, notice on
  stderr (AC-11); with probe env — `probe.attach`/`probe.detach` lines with the
  right pids and order (AC-4/AC-11); a script that spawns a descendant node
  process yields a second attach with the grandchild pid (AC-12).
- **e2e — `tests/e2e/probe.test.ts`** (built bin via `runCliAsync` — spec 016's
  lesson: never `spawnSync` around live children; `runCli` remains for
  instant-exit cases):
  - Fixtures under `tests/fixtures/probe/` as plain `.js` scripts (run by plain
    `node`, no build step): `ok.js` (prints a line, exits 0), `fail.js` (exits 3),
    `long.js` (runs until killed), `descendant.js` (spawns a node child), and a
    NODE_OPTIONS merge probe script. Existing vitest excludes keep fixtures out of
    suite collection.
  - AC-1/AC-9: `probe -- node ok.js` → exit 0, stdout byte-identical to the
    script's own output, stderr carries warning + summary; `fail.js` → exit 3.
  - AC-2/AC-3: assert probe stdout stays empty on success and on the AC-10 error
    paths; warning text present before child output ordering-wise (appears on
    stderr), names the session dir.
  - AC-4/AC-5/AC-6: parse `session.json` (schema as pinned in Contract) and
    `events.ndjson` after `ok.js`; default location under a tmp cwd; `--out`
    relocation; two runs → distinct dirs.
  - AC-7: `--duration 1` against `long.js` — probe exits bounded, `session.json`
    records the signal, session finalized.
  - AC-8: start `probe -- node long.js` asynchronously, send SIGINT to the probe,
    expect exit 130 and a finalized session recording the forwarded signal.
  - AC-10: each red path — empty/missing command, `--duration abc`, `--duration 0`,
    `--out` at a file — exit 2, stderr reason, empty stdout, no session dir.
  - AC-1 (merge): run with a preexisting `NODE_OPTIONS` pointing at a dummy `.cjs`
    that sets a global; the fixture script asserts the global exists — proving
    coexistence, not clobbering.
- No new `tests/fixtures/<rule-id>/` trees (no rules added); snapshots only for the
  `session.json` schema shape. Timing values are excluded from all assertions.
- `pnpm build` gains the hook entry; the vitest `globalSetup` builds it the same
  way it builds `dist/scripts/rule-docs.js` today (spec 017 precedent), so all
  probe tests run against the real built artifact.

## Open questions for review

- **OQ-1 — probe exit-code and termination semantics (contract; user-owned).**
  Recommendation: pass the child's exit code through (0–255, so 1 means "the child
  failed", not "diagnostics" — the probe emits none); `2` for probe
  usage/environment errors per constitution §5's spirit; `128 + signum` when the
  probe itself is signaled; `--duration` expiry requests graceful shutdown
  (SIGINT → SIGTERM → SIGKILL at fixed 5s steps) and the resulting child end is
  recorded and passed through. Alternative rejected: reserving 1 for "probe
  failed" — it would shadow the child's own exit code, which is the more useful
  signal for scriptable bounded runs.
- **OQ-2 — the trace contract itself (new, versioned file layout).**
  Recommendation: the session directory layout and `session.json`/`events.ndjson`
  schemas exactly as in Contract, versioned by a new `traceSchemaVersion`
  (starting at 1) carried in `session.json` — separate from the report's
  `schemaVersion`, which stays 1 and untouched. Default storage
  `./.backend-doctor/probe/` (plus a line in this repo's `.gitignore` so our own
  eval apps stay clean). Alternatives considered: a single `trace.json` written at
  finalize (rejected: a hard-killed child would lose all events; the two-file
  layout survives crashes and keeps appends line-atomic); a temp-dir default
  (rejected: hidden state outside the project; local-first should be visible).
- **OQ-3 — ship `--filter` now as session metadata?** The PLAN line says
  "duration/filters". Recommendation: ship the flag now — repeatable, recorded
  into `session.json.filters`, documented as the collector-restriction set that
  F019/F020 collectors must honor (lifecycle events always recorded). Alternative:
  defer the flag to F019 when events it filters exist — cleaner but deviates from
  the PLAN line's wording, and the flag's contract would then land un-reviewed
  inside a bigger feature.
- **OQ-4 — dependencies.** Recommendation: none. `node:child_process`, `node:fs`,
  `node:os` and `node:process` cover everything in F018; the tsup array-config
  split for the CJS hook entry needs no new packages.
