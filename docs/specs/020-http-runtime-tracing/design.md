# Design 020 — HTTP runtime tracing

## Module layout

| File | Purpose |
|------|---------|
| `src/probe/types.ts` | extend: `ProbeCollectorsSettings` gains `n1Threshold`; new event types `ProbeHttpRequestEvent`, `ProbeDbQueryEvent`, `ProbeMemSampleEvent`, `ProbeGcPauseEvent`; findings types `FindingsHttp`, `FindingsEndpoint`, `FindingsDb`, `FindingsDbModel`, `FindingsMemory`; `FindingsDocument` gains `http`/`db`/`memory` |
| `src/probe/options.ts` | parse/validate `BACKEND_DOCTOR_PROBE_N1_THRESHOLD` (default 20, positive finite) into `ParsedProbeOptions.collectors` |
| `src/cli/commands/probe.ts` | pass the raw env value into `parseProbeOptions` |
| `src/probe/hook.ts` | the three collectors: HTTP (emit wrap + ALS request context + route attribution), DB (`Module._load` interception + `$use` counting middleware), memory/GC (samples + observer); `parseCollectors` gains `n1Threshold`; stays one self-contained CJS entry (mirrors `types.ts` by hand) |
| `src/probe/analysis.ts` | extend `buildFindings`: parse the new events, aggregate the three sections, N+1 warnings, caps |
| `src/probe/runner.ts` | stderr summary line gains the HTTP request count; nothing else (collectors env already carries `n1Threshold` via `parsed.collectors`) |
| `tests/unit/probe/options.test.ts` | knob parsing red paths |
| `tests/unit/probe/analysis.test.ts` | extend: new sections, aggregation, warnings, caps, byte-identity |
| `tests/unit/probe/hook.test.ts` | extend: collector integration on the built `register.cjs` |
| `tests/e2e/probe.test.ts` | extend: CLI-level http/db sessions, N+1 knob, not-node zero states, summary |
| `tests/fixtures/probe/http-app.cjs`, `prisma-app.cjs`, `prisma-app.mjs`, `mem-app.cjs` | self-fetching fixtures, run by plain `node` |
| `tests/fixtures/probe/node_modules/@prisma/client/` | fake client (package.json + index.js) with a `$use` pipeline; `FAKE_PRISMA_NO_USE=1` switches it to a client without `$use` for the degradation test |

No build changes: the hook entry already bundles everything; analysis ships in
the existing bin bundle. The fixture `node_modules/` must be staged with
`git add -f` (the root `.gitignore`'s `node_modules/` pattern matches at every
depth — the spec 014 `.env` lesson).

## Key decisions

1. **HTTP instrumentation wraps `http.Server.prototype.emit`, not
   `createServer`.** All servers (plain http/https, Express, Fastify, Nest)
   dispatch `request` through the prototype; direct `new http.Server()`
   constructions are covered too. Verified live: `node:https` inherits the
   prototype, so TLS servers are covered for free; `node:http2` is a separate
   class — documented recall hole. Alternative rejected: patching
   `createServer` only (misses direct constructions and returns less natural
   request context).
2. **The request context is an `AsyncLocalStorage` store applied around the
   original emit — via a closure, not direct pass-through.** Verified live:
   `als.run(store, originalEmit, this, …)` loses `this` (the callback is
   invoked unbound) and crashes the host with a TypeError inside
   `EventEmitter.emit`; the hook must use
   `als.run(store, () => originalEmit.apply(this, [event, …]))`. The store is
   one `{ dbQueries }` object; the `finish` listener reads it by closure, not
   via `als.getStore()`, so the final read never depends on propagation
   timing.
3. **Prisma interception matches both `Module._load` call forms.** A CJS
   `require("@prisma/client")` arrives as the bare specifier; an ESM named
   import arrives as the resolved absolute path containing
   `node_modules/@prisma/client/` (verified live — the ESM loader calls
   `Module._load` post-resolution with `parent === undefined`). Matching:
   `request === id || request.includes("node_modules/" + id + "/")` for
   `@prisma/client` and `.prisma/client`.
4. **Idempotency marker sits on the wrapped class, not on the module exports.**
   `@prisma/client` copies the generated client's properties (a spread), so a
   wrapped class re-appears on a *new* exports object without any
   exports-level marker; the class-level marker is what survives the copy and
   prevents double wrapping (double wrap = every query counted twice).
5. **The DB collector wraps the class as a subclass that installs one `$use`
   middleware per instance.** `instanceof` is preserved, user code needs no
   changes (§7). The middleware times from entry to promise settle
   (`next(params).then/catch`), records `db.query`, and increments the ALS
   store when the query runs inside a request (`attributed: false`
   otherwise). If the loaded client has no `$use`, one stderr notice and the
   DB collector stands down — HTTP and memory collectors keep working
   (independent failure isolation, AC-7).
6. **No SQL text, args, or results are captured** — the middleware reads only
   `params.model` / `params.action` and wall time (§9 sensitivity).
7. **Memory sampling runs on its own unref'd `setInterval` at the lag
   interval, not inside the lag flush.** Collector failure isolation: a bug
   in the lag collector must not take down memory signals and vice versa. No
   final flush: findings use exact maxima over samples, and a short-lived
   process legitimately records zero samples.
8. **GC entries come from a `PerformanceObserver` with `{ entryTypes: ["gc"] }`;
   the kind is read from `entry.detail.kind`.** Verified live on Node
   22.13.1: the legacy `entry.kind` accessor triggers DEP0152, `detail` is
   `{ kind, flags }`, and the observer holds no event-loop reference (no
   `unref()` exists and none is needed — the host exits normally with the
   observer attached). Kind map from `perf_hooks.constants`:
   `1→minor, 4→major, 8→incremental, 16→weakcb`, else `"other"`.
9. **Endpoint percentiles are exact nearest-rank over the group's recorded
   durations** (ascending, 1-based index `ceil(p/100·n)`). Alternative
   rejected: F019's count-weighted percentile merge — that exists because
   `loop.lag` windows carry only summaries; `http.request` events carry every
   duration, so the exact value is available and stays deterministic.
10. **Caps and warnings:** endpoints and models cap at 50 rows each (same
    bound as F019's blocking calls) with `"http endpoints capped at 50
    groups"` / `"db models capped at 50 groups"`. Global warnings order is
    pinned: no-attach (F019), endpoints cap, N+1 warnings in endpoint sort
    order, models cap. N+1 warnings iterate the full sorted endpoint list
    (before the cap slice) so the cap never hides an N+1 endpoint.
11. **`n1Threshold` is required in the hook's `BACKEND_DOCTOR_PROBE_COLLECTORS`
    validation** (the parent always sets it — the env var is internal
    plumbing parent↔hook, and strict validation catches wiring bugs loudly);
    the *public* knob `BACKEND_DOCTOR_PROBE_N1_THRESHOLD` stays optional with
    default 20. Existing hook tests that pin the `collectors` block are
    updated (recorded spec consequence).
12. **Route attribution order: Express → Fastify → pathname.** Express
    markers: `req.route` with a string `path` → `req.baseUrl + req.route.path`
    (plain concatenation; a RegExp path falls through). Fastify markers:
    `req.routerPath` (v4) then `req.routeOptions.url` (v5). Fallback: URL
    pathname of `req.url` with the query stripped (`new URL(req.url,
    "http://localhost")`; malformed → the raw string). `dbQueries.avg` is
    `round3(total / count)`; `statuses` keys are inserted in ascending
    numeric order so JSON key order is deterministic.
13. **`db` models table keys `(model, action)` with `model: null` rendered as
    `null`** (raw-query actions); sorting treats null as `""`. Group keys use
    `JSON.stringify` arrays like F019's blocking aggregation.
14. **The stderr summary line extends once:** `…, lag p99 Zms, N http
    request(s)`. Existing assertions pin fragments, not the whole line, so
    they stay green; the exact wording is ours (AGENTS.md).

## Dependencies

None new. `AsyncLocalStorage` (`node:async_hooks`), `PerformanceObserver` /
`constants` (`node:perf_hooks`), and `Module` (`node:module`) are node core;
the hook bundle already compiles CJS `require`-style code via tsup.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/unit/probe/hook.test.ts` — "http: completed cycles record http.request events" (`http-app.cjs`) |
| AC-2 | `tests/unit/probe/hook.test.ts` — same test: express-marker route vs pathname fallback |
| AC-3 | `tests/unit/probe/hook.test.ts` — "db: queries attribute to the enclosing request" (`prisma-app.cjs` + fake client) |
| AC-4 | `tests/unit/probe/hook.test.ts` — "db: CJS require wraps the client" + "db: ESM named import wraps the client" (`prisma-app.mjs`); wrap idempotency asserted by the stub-copy in the fake package |
| AC-5 | `tests/unit/probe/hook.test.ts` — "memory: periodic samples and gc events" (`mem-app.cjs`, interval knob 150) |
| AC-6 | `tests/unit/probe/hook.test.ts` — "inert: emit, Module._load and client stay native without collectors" (marker probes) |
| AC-7 | `tests/unit/probe/hook.test.ts` — "db: a client without $use degrades with one notice, http keeps recording" (`FAKE_PRISMA_NO_USE=1`) |
| AC-8 | `tests/unit/probe/hook.test.ts` — "http: an aborted request records nothing" (the `/abort` route in `http-app.cjs`) |
| AC-9 | `tests/unit/probe/options.test.ts` — n1Threshold red paths; e2e invalid knob → exit 2, no session |
| AC-10 | `tests/unit/probe/hook.test.ts` — attach collectors block carries n1Threshold (updated COLLECTORS pins); e2e findings.collectors pin |
| AC-11 | `tests/unit/probe/analysis.test.ts` — endpoint aggregation, nearest-rank percentiles pinned, tie-breaks, statuses order, cap+warning |
| AC-12 | `tests/unit/probe/analysis.test.ts` — N+1 warnings at/above/below threshold in endpoint order; e2e with `BACKEND_DOCTOR_PROBE_N1_THRESHOLD=2` |
| AC-13 | `tests/unit/probe/analysis.test.ts` — db totals, unattributed, models order + cap |
| AC-14 | `tests/unit/probe/analysis.test.ts` — memory peaks and gc aggregation |
| AC-15 | `tests/unit/probe/analysis.test.ts` — zero states/key sets; e2e not-node zero states |
| AC-16 | `tests/unit/probe/analysis.test.ts` — byte-identical re-analysis with the new events |
| AC-17 | e2e — `assertCommonSession` on the http session; `fail.js` still exits 3 (existing) |
| AC-18 | e2e — stderr summary names the http request count; stdout purity asserted on every new path |

Existing-test consequences (recorded in spec): the `COLLECTORS` constants and
`findings.collectors` / zero-state key-set pins gain `n1Threshold` and
`http`/`db`/`memory`; the e2e not-node test gains the three zero-state
sections. No other existing behavior changes; `fail.js`, `spin.cjs`, `ok.js`
sessions stay byte-compat.
