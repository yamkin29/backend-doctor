# Spec 020 — HTTP runtime tracing (F020)

- **Status:** Implemented (2026-09-21)
- **Phase:** 5 — Runtime engine
- **Depends on:** F018 Runtime probe runner (Done — session layout, `NODE_OPTIONS`
  hook injection, NDJSON discipline, `runCliAsync`), F019 Event loop & blocking
  attribution (Done — collectors plumbing, `findings.json` at finalize, env-knob
  validation, async-context tagging groundwork)
- **Blocks:** F021 Combined report (consumes the new `http`/`db`/`memory`
  findings sections), F022 Eval corpus (owns the probe check on a whole bad app
  with real frameworks)

## Problem

F019 made the probe prove *blocking* on a real run, but a backend's story is
told at the HTTP boundary: which endpoints are slow, which of them hammer the
database per request (the runtime twin of the static `no-prisma-n-plus-one`
suspect), and what memory/GC pressure the process lived under. The PLAN's F020
line — "endpoint latency (Express/Fastify/Nest interceptors), DB query count per
request (runtime N+1 detection), memory/GC signals" — is unimplemented: the
hook records lifecycle, lag, and sync blocking only, and `findings.json` has no
HTTP, DB, or memory sections. F020 adds three collectors inside the existing
preload hook and extends the deterministic finalize analysis. No new commands,
flags, rules, or dependencies.

## Goals

- G1. **HTTP collector** — inside the hook, when collectors are active:
  `http.Server.prototype.emit` is wrapped (verified live: covers plain
  `node:http`/`node:https` servers, hence Express, Fastify and Nest apps
  alike). Each `request` event runs inside a fresh `AsyncLocalStorage` store;
  when the response `finish`es, one `http.request` event records `method`,
  `route`, `status`, `durationMs`, and `dbQueries` (queries counted in that
  request's context). Route attribution: Express-style `req.baseUrl` +
  `req.route.path`, Fastify-style `req.routerPath` (v4) / `req.routeOptions.url`
  (v5), else the URL pathname without query.
- G2. **DB-query collector (Prisma-first)** — inside the hook: `Module._load`
  interception catches `@prisma/client` and `.prisma/client` loads — both the
  CJS bare-specifier form and the ESM resolved-path form (verified live; the
  ESM loader hands `Module._load` an absolute `node_modules/…` path). The
  exported `PrismaClient` class is wrapped by a subclass whose constructor
  installs a `$use` counting middleware, so every instance counts queries
  without user-code changes. Each query records a `db.query` event (`model`,
  `action`, `durationMs`, `attributed`) and increments the enclosing request's
  per-request counter via the ALS store. No SQL text, args, or results are
  captured (constitution §9).
- G3. **Memory/GC collector** — inside the hook: periodic `mem.sample` events
  on the lag-window cadence (`rssMb`, `heapUsedMb`, `heapTotalMb`,
  `externalMb`) plus one `gc.pause` event per garbage collection observed via
  `perf_hooks` `PerformanceObserver` (`kind` read from `entry.detail` — the
  legacy accessor is DEP0152 — and `durationMs`). Verified live: the observer
  keeps no reference to the event loop (the host exits normally with it
  observing).
- G4. **Runtime N+1 signal** — `findings.json` gains a deterministic warning
  per endpoint whose maximum per-request DB-query count reached
  `n1Threshold` (default 20, env-tunable, parent-validated before spawn like
  the F019 knobs). Raw counts remain in the findings regardless.
- G5. **Deterministic findings extension** — `buildFindings` (pure, F019)
  gains `http`, `db`, and `memory` sections with pinned key sets, exact
  nearest-rank per-endpoint percentiles, fixed sort orders, 50-group caps with
  warnings, and structural zero states. Same events file → byte-identical
  `findings.json`.
- G6. **Contracts stay additive** — `traceSchemaVersion` stays `1` (F019
  precedent: new event types and findings sections are additions within it).
  No new CLI flags or commands; `session.json` byte-shape frozen; exit codes
  untouched; `--filter` semantics unchanged (it governs file-attributed
  `block.call` events only — the new events carry no file paths).

## Non-goals

- **Combined report** (merging runtime findings with static diagnostics,
  `runtime` tag, reporter changes) — F021. Findings never influence probe exit
  codes.
- **HTTP/2 and WebSocket traffic** — `node:http2` has its own server machinery
  outside `http.Server.prototype`; not in any PLAN line. Documented recall
  hole.
- **Non-Prisma databases** (`pg`, `mysql2`, `mongodb`, TypeORM, Mongoose
  packs) — Prisma-first per PLAN decisions; other drivers belong to future
  packs.
- **Prisma `$extends`-based instrumentation** — `$use` middleware is the
  mechanism this feature ships; a `$extends` fallback would double the
  surface for the same counts (design decision, see Contract).
- **Query payload capture** (SQL text, arguments, results, headers, bodies,
  query strings) — sensitivity (constitution §9); only counts, durations,
  status codes, routes, and model/action names.
- **Framework-internal spans** (middleware timing, Nest interceptor API) —
  measurement stays at the HTTP server layer. Nest's interceptor API would
  require registering code in the user's app — a §7 violation; the PLAN's
  "(Express/Fastify/Nest interceptors)" parenthetical is satisfied at the
  server layer, which all three frameworks ride.
- **Cross-process latency-stream merging beyond per-endpoint aggregation** —
  endpoints aggregate per `(method, route)` across all attaching processes;
  no per-request timeline.
- **CLI flags for collector knobs** — env-var tuning only (F019 precedent,
  constitution §10).
- **Trace redaction beyond the F018 posture** — findings contain routes and
  model names; they stay local under the session directory (§9).
- **Reporters/UI for traces** — no feature line.
- **Windows-specific behavior** — POSIX-first like the rest of the toolchain.

## User stories

1. **Backend developer** — she runs `backend-doctor probe --duration 60 -- npm
   run dev`, exercises her endpoints, and after shutdown `findings.json` shows
   per-endpoint latency (`p50`/`p99`/max, status counts), how many DB queries a
   single request issued per endpoint, an explicit "possible N+1" warning
   naming the offending endpoint, peak RSS/heap, and GC pause totals. The
   stderr summary line includes the request count.
2. **CI author** — probe exit codes are unchanged (child pass-through, 2
   usage, 128+signum); `findings.json` stays a versioned machine-readable file
   at the same path, its new sections additive; the summary stays stderr-only;
   probe's stdout stays empty on every path.
3. **AI agent** — the agent reads `findings.json` (stable key sets, fixed
   ordering, deterministic bytes for a given events file) and `events.ndjson`
   (additive event types it may ignore). It branches on `traceSchemaVersion: 1`
   as before and treats unknown event types and unknown fields as ignorable.

## Contract / Model

Parts marked **[OQ-n]** are gated on the open questions; the text below states
the recommended shape.

### CLI surface — unchanged

```
backend-doctor probe [--duration <seconds>] [--out <dir>] [--filter <glob>]... -- <command> [args...]
```

No new flags. One collector knob joins the environment plumbing (validated by
the parent **before spawn**; invalid → usage error, exit 2, no session
directory — F019 precedent):

- `BACKEND_DOCTOR_PROBE_N1_THRESHOLD` — the per-request DB-query count that
  triggers the N+1 warning, default `20`; must be a positive finite number.

The parent normalizes it into the existing injection env var:

- `BACKEND_DOCTOR_PROBE_COLLECTORS` — JSON
  `{"blockThresholdMs":<n>,"lagIntervalMs":<n>,"n1Threshold":<n>}`; its
  presence still activates the collectors; the new field is additive and
  validated by the hook the same way.

`BACKEND_DOCTOR_PROBE_FILTERS` semantics are unchanged: `--filter` globs
restrict file-attributed `block.call` events (F019). `http.request`,
`db.query`, `mem.sample`, and `gc.pause` carry no file paths and are recorded
regardless of filters.

### Session directory layout — unchanged

```
<out>/<session-id>/
├─ session.json    unchanged — exact F018 key set
├─ events.ndjson   lifecycle + F019 + new collector event types (below)
└─ findings.json   grown by three sections (below)
```

### `events.ndjson` — new event types (additive within `traceSchemaVersion: 1`)

Every event keeps the F018 envelope: `type`, `timestamp` (ISO-8601 UTC),
`pid`. `probe.attach`'s optional `collectors` block gains `n1Threshold`.

`http.request` — one per **completed** response (`finish`); requests aborted
or never finished record nothing:

```json
{"type": "http.request", "timestamp": "…", "pid": 123,
 "method": "GET", "route": "/users/:id", "status": 200,
 "durationMs": 41.317, "dbQueries": 12}
```

- **Route attribution rule:** Express-style — when `req.route` exists with a
  string `path`, `route` is `req.baseUrl + req.route.path` (plain string
  concatenation, no separator normalization); Fastify-style — else when
  `req.routerPath` (v4) or `req.routeOptions?.url` (v5) is a string, that
  string; fallback — else the URL pathname of `req.url` with the query string
  stripped (parsed via `new URL(req.url, "http://localhost")`; a malformed
  URL records the raw `req.url` string). A RegExp `req.route.path` falls back
  to the pathname (documented recall edge).
- `durationMs` is measured from the wrapped `emit("request")` entry to
  `finish` (`performance.now()` delta, rounded to 3 decimals).
- `dbQueries` is the count of instrumented Prisma queries executed inside the
  request's async context (ALS store); `0` when the DB collector is off or no
  query ran.

`db.query` — one per instrumented Prisma query:

```json
{"type": "db.query", "timestamp": "…", "pid": 123,
 "model": "User", "action": "findMany", "durationMs": 3.21,
 "attributed": true}
```

- `model` is `null` for non-model actions (`$queryRaw`, `$executeRaw`).
- `attributed` is `true` when the query ran inside a request's ALS context;
  startup, timer, or detached-context queries are `attributed: false` and
  never inflate an endpoint's counts.
- **Instrumentation rule (verified live on Node 22.13.1):** `Module._load` is
  patched to intercept requests equal to `@prisma/client` or `.prisma/client`
  (CJS bare specifier) or containing `node_modules/@prisma/client/` /
  `node_modules/.prisma/client/` (the form ESM imports arrive in). The wrap
  is idempotent (a marker on the module exports) and only applies when the
  exports expose a `PrismaClient` function. The subclass wrapper preserves
  `instanceof` and installs one `$use` middleware per instance; the
  middleware times the query, records the event, and increments the request
  store when one is active. If the loaded client has no `$use` function, the
  DB collector records one stderr notice and disables itself — HTTP and
  memory collectors are unaffected.

`mem.sample` — one per lag-window tick (same interval as `loop.lag`; no final
flush — findings use peaks only):

```json
{"type": "mem.sample", "timestamp": "…", "pid": 123,
 "rssMb": 182.357, "heapUsedMb": 91.204, "heapTotalMb": 104.512,
 "externalMb": 2.113}
```

`gc.pause` — one per garbage collection the observer sees:

```json
{"type": "gc.pause", "timestamp": "…", "pid": 123,
 "kind": "minor", "durationMs": 0.243}
```

- `kind` maps `perf_hooks.constants` GC kinds to `"minor" | "major" |
  "incremental" | "weakcb"`, anything else to `"other"`. The kind is read
  from `entry.detail.kind` (the legacy `entry.kind` accessor is DEP0152).

### `findings.json` — three new sections (additive; existing sections unchanged)

Top-level key order: `traceSchemaVersion`, `sessionId`, `collectors`,
`loopLag`, `blocking`, `http`, `db`, `memory`, `events`, `warnings`.

```json
{
  "http": {
    "requests": 12,
    "endpoints": [
      {"method": "GET", "route": "/users/:id", "count": 5,
       "p50Ms": 3.2, "p99Ms": 41.0, "maxMs": 41.0,
       "statuses": {"200": 4, "500": 1},
       "dbQueries": {"total": 57, "max": 12, "avg": 11.4}}
    ]
  },
  "db": {
    "queries": 30, "totalMs": 55.207, "unattributed": 4,
    "models": [
      {"model": "User", "action": "findMany", "count": 12}
    ]
  },
  "memory": {
    "samples": 12, "peakRssMb": 182.357, "peakHeapUsedMb": 91.204,
    "gc": {"count": 7, "totalPauseMs": 12.4, "maxPauseMs": 3.1}
  }
}
```

- `http.requests` counts all analyzed `http.request` events (across
  processes). `endpoints` aggregates them grouped by `(method, route)`;
  `p50Ms`/`p99Ms` are **exact nearest-rank percentiles over the recorded
  per-request durations of that group** (sorted ascending, 1-based index
  `ceil(p/100 × n)`); `statuses` maps the stringified status code to its
  count, keys in ascending numeric order; `dbQueries.total`/`max` are exact
  sums/max of the group's per-request counts, `avg` is
  `round3(total / count)`. Sorted by `p99Ms` desc, tie-breaks `method` asc
  then `route` asc, capped at the top 50 groups (a cap appends
  `"http endpoints capped at 50 groups"` to `warnings`).
- **N+1 warnings:** every endpoint whose `dbQueries.max ≥ n1Threshold`
  appends `"endpoint <METHOD> <route> saw up to <max> db queries in one
  request (possible N+1)"` to `warnings`, in endpoint sort order. [OQ-3]
- `db.queries`/`db.totalMs` count all analyzed `db.query` events;
  `unattributed` counts `attributed: false` ones. `models` aggregates by
  `(model, action)` (null model keyed as `null`), sorted by `count` desc with
  `model` asc then `action` asc tie-breaks, capped at the top 50 rows
  (warning `"db models capped at 50 groups"`).
- `memory.samples` counts `mem.sample` events; `peakRssMb`/`peakHeapUsedMb`
  are exact maxima across processes; `gc.count`/`totalPauseMs`/`maxPauseMs`
  aggregate all `gc.pause` events (total rounded to 3 decimals).
- Zero states are structural (`endpoints: []`, `models: []`, zeros), never
  omitted keys — a not-Node target yields the same sections at zero as F019's
  fields do.
- Determinism: the analysis stays a pure function of `events.ndjson` + session
  id + collector settings; aggregation keys, sort orders, caps, and the
  nearest-rank rule are pinned. Sampled values vary between runs by nature
  (F018's constitution §1 carve-out, extended).

### Hook discipline (extends F019's)

- The new collectors are active **only** with the collectors env present and
  valid; lifecycle-only mode (absent env) and F019's malformed-env behavior
  are unchanged: no emit wrap, no `Module._load` patch, no new events —
  observable inertness.
- Each new collector that fails to install or throws records one stderr
  notice and disables itself, independently of the others; the host app is
  never affected (constitution §7). The ALS pass-through must apply the
  original emit with the server as `this` (verified: passing the unbound
  method to `als.run` crashes the host — the hook wraps it in a closure).
- The request-timing timers (`res.once("finish", …)` listeners) and the
  `PerformanceObserver` never keep the host alive (verified: Node's observer
  holds no loop reference); the sampling timer stays unref'd like F019's.
- Hook-bundle activity (event writes) never appears as a counted query or a
  recorded request: the hook never issues HTTP requests or Prisma queries of
  its own, and the existing `inHookWrite` re-entrancy guard continues to keep
  its `fs` appends invisible to the blocking collector.
- Numbers: durations/percentiles/MB values are rounded to 3 decimals at event
  write time; aggregates re-round to 3 decimals — the same discipline as F019
  so bytes stay stable and short.

### Constitution notes

- §1 (deterministic): static analysis untouched; findings analysis is pure and
  byte-stable for identical events; sampled runtime values vary per run
  (documented carve-out).
- §5 (stable contracts): everything additive — no flag, config field, exit
  code, report-schema, or `schemaVersion` change; `session.json` byte-shape
  frozen; `traceSchemaVersion` stays `1`; consumers ignore unknown event
  types/fields by contract.
- §7 (zero intrusion): preload-only; `http`/`Module._load` patching happens in
  the host process exactly like F019's core-module wrapping (no user file is
  read for modification or written); timers/listeners never keep the host
  alive; a collector failure cannot alter app behavior beyond one stderr
  notice.
- §8 (fail loud): stderr summary on every finalize; per-collector failure
  notices once; malformed event lines already counted, not dropped silently.
- §9 (local-first): no SQL text/args/results/headers/bodies are ever captured;
  routes and model names stay in the local session directory.
- §10 (small surface): zero new commands, zero new flags.

## EARS acceptance criteria

**Collectors (hook side)**

- **AC-1.** WHEN a completed HTTP request/response cycle occurs in a process
  with collectors active THE SYSTEM SHALL record exactly one `http.request`
  event carrying `method`, `route`, `status`, `durationMs ≥ 0`, and
  `dbQueries`.
- **AC-2.** WHEN the routing framework exposes an Express-style route marker
  or a Fastify-style route marker THE SYSTEM SHALL record the route pattern;
  WHEN no marker exists THE SYSTEM SHALL record the URL pathname without the
  query string.
- **AC-3.** WHEN an instrumented Prisma query runs inside a request's async
  context THE SYSTEM SHALL increment that request's `dbQueries` count and
  record a `db.query` event with `model`, `action`, `durationMs`, and
  `attributed: true`; WHEN a query runs outside any request THE SYSTEM SHALL
  record `attributed: false` and no endpoint's counts change.
- **AC-4.** WHEN the Prisma client is loaded through a CJS require or an ESM
  named import THE SYSTEM SHALL wrap it identically, and the wrap SHALL be
  idempotent across repeated loads.
- **AC-5.** WHEN a process with collectors active runs longer than the
  sampling interval THE SYSTEM SHALL record periodic `mem.sample` events with
  all four memory fields, and SHALL record a `gc.pause` event per observed
  garbage collection with `kind` and `durationMs`; WHEN the process is
  short-lived THE SYSTEM MAY record zero samples (field shapes still pinned).
- **AC-6.** WHEN the hook loads without the probe session environment or with
  lifecycle-only mode THE SYSTEM SHALL leave `http.Server.prototype.emit`,
  `Module._load`, and core functions in their native state, record no new
  event types, and behave exactly as in F019.
- **AC-7.** WHEN any new collector fails to install or throws inside the host
  THE SYSTEM SHALL disable that collector alone after one stderr notice and
  leave the host app and the other collectors running unaffected.
- **AC-8.** WHEN a request never finishes (aborted or destroyed) THE SYSTEM
  SHALL record no `http.request` event for it.

**Options / parent**

- **AC-9.** WHEN the probe parent's environment contains an invalid
  `BACKEND_DOCTOR_PROBE_N1_THRESHOLD` (non-numeric, zero, negative,
  non-finite) THE SYSTEM SHALL exit `2` with the reason on stderr before
  spawning, leaving no session directory and nothing on stdout.
- **AC-10.** WHEN collectors are active THE SYSTEM SHALL carry `n1Threshold`
  in the `collectors` block of both the `probe.attach` event and
  `findings.json`. [OQ-4]

**Analysis (probe parent at finalize)**

- **AC-11.** WHEN `http.request` events exist THE SYSTEM SHALL aggregate them
  into `http.endpoints` grouped by `(method, route)` with `count`, exact
  nearest-rank `p50Ms`/`p99Ms`, `maxMs`, ascending-numeric `statuses` map,
  and `dbQueries` `total`/`max`/`avg`, sorted by `p99Ms` desc with `method`
  asc then `route` asc tie-breaks, capped at 50 groups with a `warnings`
  entry when capped.
- **AC-12.** WHEN an endpoint's `dbQueries.max ≥ n1Threshold` THE SYSTEM SHALL
  append an N+1 warning naming the method, route and count, in endpoint sort
  order. [OQ-3]
- **AC-13.** WHEN `db.query` events exist THE SYSTEM SHALL aggregate `db`
  totals (`queries`, `totalMs`, `unattributed`) and a `models` table grouped
  by `(model, action)` sorted by `count` desc with `model` asc then `action`
  asc tie-breaks, capped at 50 rows with a `warnings` entry when capped.
- **AC-14.** WHEN `mem.sample`/`gc.pause` events exist THE SYSTEM SHALL
  aggregate `memory` as peak `rssMb`/`heapUsedMb`, sample count, and GC
  `count`/`totalPauseMs`/`maxPauseMs`.
- **AC-15.** WHEN `events.ndjson` contains no `probe.attach` event THE SYSTEM
  SHALL keep the F019 no-attach warning and write structural zero states for
  all new sections.
- **AC-16.** WHEN the same `events.ndjson` is analyzed twice THE SYSTEM SHALL
  produce byte-identical `findings.json` including the new sections.

**Discipline**

- **AC-17.** WHEN findings are produced THE SYSTEM SHALL NOT change probe exit
  codes (F018 pass-through/2/128+signum semantics), SHALL leave `session.json`
  byte-shape-identical to the F018 contract, and SHALL keep probe's stdout
  empty on every path.
- **AC-18.** WHEN a session finalizes THE SYSTEM SHALL print one stderr
  summary line naming `findings.json` with the blocking count, lag p99, and
  the HTTP request count.

## Testing strategy (TDD)

- **Unit — `tests/unit/probe/analysis.test.ts`** (extend; synthetic events,
  no committed fixture tree): new-section zero states and key sets (AC-15);
  endpoint aggregation with exact nearest-rank percentiles pinned on small
  duration sets, tie-breaks, cap+warning (AC-11); N+1 warnings at and below
  the threshold, deterministic order (AC-12); db totals/unattributed/models
  with cap (AC-13); memory peaks and GC aggregation (AC-14); byte-identical
  re-analysis with the new events (AC-16); unknown/new event types ignored by
  the existing sections.
- **Unit — `tests/unit/probe/options.test.ts`** (extend): `n1Threshold`
  parsing — default when absent, red paths `abc`/`0`/`-1`/`""`/`Infinity`
  (AC-9).
- **Hook integration — `tests/unit/probe/hook.test.ts`** (extend; built
  `register.cjs` via `spawnSync`, F018/F019 pattern). New fixtures under
  `tests/fixtures/probe/`, run by plain `node` (repo is `"type": "module"` —
  `require()`-based fixtures are `.cjs`):
  - `http-app.cjs` — a `node:http` server that fetches itself: one route
    emulating an Express marker (`req.route = { path: "/users/:id" }`,
    `req.baseUrl = ""` — exactly what express sets, so the attribution logic
    is exercised without the dependency), one unmarked route, and one client-
    aborted request whose handler never calls `end`. Assertions: `http.request`
    events for the completed routes only (AC-1, AC-8), route pattern vs
    pathname fallback (AC-2), `dbQueries: 0`, `statuses`/`durationMs` field
    shapes.
  - `prisma-app.cjs` + fixture-local `node_modules/@prisma/client/` (a fake
    client with a `$use` middleware pipeline — the interception mechanism is
    what we test, not Prisma itself): a startup query plus queries inside an
    HTTP handler. Assertions: `db.query` events with `model`/`action`/
    `attributed` (AC-3), the request's `http.request.dbQueries` equals the
    in-request query count, the startup query is `attributed: false` (AC-3),
    CJS path wrapped (AC-4).
  - `prisma-app.mjs` — same fake client through an ESM named import (AC-4,
    the resolved-path interception form).
  - `mem-app.cjs` — lives ~1s allocating garbage with a small interval knob:
    ≥ 2 `mem.sample` events with well-typed fields; `gc.pause` events asserted
    structurally (field types only, zero-or-more — F019's "pin types, not
    positivity" lesson) (AC-5).
  - Inertness: without the collectors env, `http.Server.prototype.emit` and
    `Module._load` carry no wrapper markers and no new event types appear
    (AC-6).
  - Failure isolation: a fixture whose fake client lacks `$use` → one notice,
    no `db.query` events, `http.request` events still recorded (AC-7).
- **e2e — `tests/e2e/probe.test.ts`** (extend; `runCliAsync`):
  - `probe -- node http-app.cjs`: exit 0, stdout passthrough, findings
    `http.requests` ≥ 2 with the `/users/:id` endpoint row, stderr summary
    names the request count (AC-1/AC-18); `session.json` unchanged via the
    existing `assertCommonSession` (AC-17).
  - `probe -- node prisma-app.cjs` (threshold knob left default): findings
    `db` totals populated, endpoint row carries the per-request `dbQueries`
    totals, the N+1 warning appears when the fixture exceeds 20 queries
    (AC-3/AC-12 CLI level).
  - `BACKEND_DOCTOR_PROBE_N1_THRESHOLD=abc` → exit 2, stderr reason, no
    session dir, empty stdout (AC-9).
  - not-Node session (`sh -c "echo not-node"`): findings zero-state for
    `http`/`db`/`memory` with the existing no-attach warning (AC-15).
- **Existing-test consequences (recorded):** every exact pin of the
  `collectors` block (`attach.collectors` and `findings.collectors`
  `toEqual`s in hook tests and e2e) gains `n1Threshold`; the e2e findings
  top-level key-set pin and the analysis zero-state key-set pin gain
  `http`/`db`/`memory`; the stderr-summary assertions may keep passing (they
  assert fragments) but the summary line's exact wording changes once. No
  `tests/fixtures/<rule-id>/` trees, no `docs/rules/` changes; rule-docs gate
  untouched.
- **Dependencies: none** [OQ-1] — the fake Prisma client fixture and the
  emulated Express markers stand in for the real packages; real-framework
  validation belongs to F022's eval corpus. Timing values are excluded from
  assertions except ≥ 0 bounds and field types.
- Build: no new entries — the hook entry already rebuilds on every test run
  via the array-aware `globalSetup`; analysis ships inside the existing bin
  bundle.

## Open questions for review

All four were resolved on approval (2026-09-21) by adopting the recommendations:
(1) no new dependencies — a fixture-local fake Prisma client and emulated route
markers stand in for real frameworks, whose validation belongs to F022's eval
corpus; (2) DB-query counting is Prisma-only via `Module._load` interception +
`$use` middleware, with one-notice graceful degradation when `$use` is
unavailable; (3) N+1 detection is a threshold warning, default 20, env-tunable
via `BACKEND_DOCTOR_PROBE_N1_THRESHOLD` (parent-validated, invalid → exit 2);
(4) `n1Threshold` joins the `collectors` settings block, and the existing
exact-key-set pins are updated accordingly.

- **OQ-1 — dependencies: none vs adding `express` + `@prisma/client` as
  devDependencies for true-framework e2e.** Recommendation: **none** — the
  interception and route-attribution mechanisms are exercised through a
  fixture-local fake client and emulated route markers (both verified live on
  Node 22.13.1); real-framework smoke belongs to F022's eval corpus, keeping
  install weight and version coupling out. Alternative: real devDeps give
  truer e2e but pin framework versions in a static-analysis repo and grow
  install time for the whole team.
- **OQ-2 — DB-query counting scope: Prisma-only (recommended) vs generic
  driver instrumentation (`pg`/`mysql2`/`mongodb`) vs deferring the DB
  dimension entirely.** Recommendation: **Prisma-only**, via `Module._load`
  interception + `$use` middleware — Prisma-first is a PLAN decision, `$use`
  works across Prisma 5/6, and graceful degradation (one notice when `$use`
  is unavailable) keeps the failure mode loud but harmless. Generic drivers
  would multiply the wrapped surface beyond this PLAN line; deferral would
  leave "DB query count per request (runtime N+1 detection)" unimplemented.
- **OQ-3 — N+1 detection shape: threshold warning (recommended) vs raw
  numbers only.** Recommendation: warning when an endpoint's max per-request
  query count ≥ `n1Threshold` (default 20, `BACKEND_DOCTOR_PROBE_N1_THRESHOLD`,
  parent-validated; invalid → exit 2) — the PLAN line says "runtime N+1
  detection", and the raw counts ship in the findings either way. Alternative:
  numbers only — simpler, but pushes the judgment onto every consumer.
- **OQ-4 — where `n1Threshold` lives: in the `collectors` settings block
  (recommended) vs a separate findings/session field.** Recommendation: join
  the block — one settings source mirrors F019's shape (`probe.attach` and
  `findings.json` already carry it); the exact-key-set pins in existing tests
  are updated (recorded consequence). Alternative: a separate field avoids
  touching pinned key sets but forks collector settings into two places.
