# Tasks 020 — HTTP runtime tracing

TDD order: pure option parsing first, then the pure analysis the parent runs
(things tests import come before things that import them), then the hook
collectors in dependency order (settings → memory → http → db), then the
CLI-level e2e wiring, close-out last.

- [x] **T1. `n1Threshold` knob in options (AC-9).** RED:
  `tests/unit/probe/options.test.ts` — default 20 when absent; accepted
  values parse into `collectors.n1Threshold`; red paths
  `abc`/`0`/`-1`/`""`/`Infinity` → error naming
  `BACKEND_DOCTOR_PROBE_N1_THRESHOLD`. GREEN: `src/probe/options.ts`
  (constant + parsing) and `src/cli/commands/probe.ts` (raw env passthrough).

- [x] **T2. Findings types + analysis sections (AC-11..AC-16).** RED:
  `tests/unit/probe/analysis.test.ts` — zero-state key sets with the three
  new sections; endpoint aggregation with pinned nearest-rank percentiles,
  tie-breaks, ascending-numeric statuses, cap + warning; N+1 warnings at /
  above / below threshold in endpoint order; db totals + unattributed +
  models order/cap; memory peaks + gc aggregation; byte-identical
  re-analysis; unknown event types ignored. GREEN: `src/probe/types.ts`
  (new event + findings interfaces, `n1Threshold` in
  `ProbeCollectorsSettings`) and `src/probe/analysis.ts`.

- [x] **T3. Hook settings plumbing (AC-10, hook level).** RED:
  `tests/unit/probe/hook.test.ts` — attach's `collectors` block carries
  `n1Threshold` when the env carries three valid fields; malformed env stays
  lifecycle-only with one notice. Existing `COLLECTORS` constants updated
  (recorded consequence). GREEN: `src/probe/hook.ts` — `parseCollectors`
  validates `n1Threshold`, attach event includes it.

- [x] **T4. Memory/GC collector (AC-5).** RED:
  `tests/unit/probe/hook.test.ts` — `mem-app.cjs` with a 150ms interval knob
  yields ≥ 2 `mem.sample` events with the four well-typed MB fields;
  `gc.pause` events, when present, carry `kind` ∈ known set and numeric
  `durationMs`; the host runs to completion (observer never keeps the loop
  alive). GREEN: `src/probe/hook.ts` — `installMemoryCollector` (own unref'd
  interval + PerformanceObserver, `entry.detail.kind`).

- [x] **T5. HTTP collector (AC-1, AC-2, AC-6, AC-8).** RED:
  `tests/unit/probe/hook.test.ts` — `http-app.cjs`: `http.request` events
  for completed routes with route pattern (`/users/:id`) vs pathname
  fallback, method/status/durationMs/dbQueries shapes, no event for the
  aborted route; inert-mode marker probe: `http.Server.prototype.emit`
  stays native without the collectors env. GREEN: `src/probe/hook.ts` —
  `installHttpCollector` (ALS closure-applied emit wrap, route attribution,
  finish listener).

- [x] **T6. DB collector (AC-3, AC-4, AC-7).** RED:
  `tests/unit/probe/hook.test.ts` — `prisma-app.cjs` + fake
  `node_modules/@prisma/client`: `db.query` events with model/action/
  attributed, per-request `dbQueries` counts (startup query
  `attributed: false`), CJS wrap; `prisma-app.mjs` — ESM named import wrap;
  `FAKE_PRISMA_NO_USE=1` — one notice, no `db.query`, http events keep
  flowing; inert-mode probe: the client class stays unwrapped without the
  collectors env. GREEN: `src/probe/hook.ts` — `installDbCollector`
  (`Module._load` interception, dual-form matching, subclass + `$use`
  middleware).

- [x] **T7. CLI-level wiring (AC-9, AC-12, AC-15, AC-17, AC-18).** RED:
  `tests/e2e/probe.test.ts` — http session (exit 0, stdout passthrough,
  `findings.http` populated with the `/users/:id` endpoint, summary names
  the request count, `assertCommonSession` unchanged); prisma session
  (`db` totals + endpoint `dbQueries`); N+1 warning end-to-end with
  `BACKEND_DOCTOR_PROBE_N1_THRESHOLD=2`; invalid knob → exit 2, no session,
  empty stdout; not-node session → structural zero states for the three
  sections; findings key-set and collectors pins updated (recorded
  consequence). GREEN: `src/probe/runner.ts` — summary line gains the http
  request count.

- [x] **T8. Close-out (no TDD).** Check off tasks; record deviations;
  move durable findings into `docs/RESEARCH.md` (ALS `this`-binding trap,
  the emit-passthrough event-name drop, ESM resolved-path form of
  `Module._load`, DEP0152 `entry.detail`, observer liveness, fixture
  `node_modules` needs `git add -f`); spec status → Implemented;
  `docs/PLAN.md` F020 → Done.

## Deviations & notes

- **T5 — the emit passthrough dropped the event name (real bug caught by
  the new fixture, red state hung).** The first GREEN implementation routed
  non-request emits through a helper that called the original emit with the
  rest args only: `originalEmit.apply(this, args)` where `args` excludes
  `event`. Every host emit therefore became `emit(undefined)` — no listeners
  ever ran, `server.listen`'s callback never fired, and the app hung with a
  half-bound socket. The earlier live verification (the preload prototype
  that informed the spec) passed `[event, ...args]` explicitly and never
  hit this, which is why the spec's "verified live" note did not surface it.
  The fixture-level red (a self-fetching server that never completed) caught
  it immediately; the fix re-joins event + args in the passthrough and the
  trap is documented in `docs/RESEARCH.md`.
- **T5 — ALS run callback must be a closure.** Passing the unbound
  `originalEmit` directly as `als.run`'s callback crashes the host (the
  callback is invoked without a `this`); the wrap applies it through a
  closure. Also verified live; recorded in `docs/RESEARCH.md`.
- **T2 — two RED test-data mistakes fixed before green** (Post grouped from
  a single event instead of three; model cap expected count-desc order for
  equal counts where the pinned tie-break is model-asc). No implementation
  change; the sort/tie-break semantics matched the spec.
- **Existing-test consequences exactly as the spec recorded:** the
  `COLLECTORS` constants, `findings.collectors`/zero-state key-set pins, and
  the findings top-level key-set pin gained `n1Threshold` and
  `http`/`db`/`memory`; the fixture `node_modules/` tree was staged with
  `git add -f` (the root `.gitignore` matches `node_modules/` at every
  depth, the spec 014 `.env` lesson's twin).
- No spec AC changed during implementation; no reality-vs-spec conflicts.
