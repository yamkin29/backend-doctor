# Tasks 020 — HTTP runtime tracing

TDD order: pure option parsing first, then the pure analysis the parent runs
(things tests import come before things that import them), then the hook
collectors in dependency order (settings → memory → http → db), then the
CLI-level e2e wiring, close-out last.

- [ ] **T1. `n1Threshold` knob in options (AC-9).** RED:
  `tests/unit/probe/options.test.ts` — default 20 when absent; accepted
  values parse into `collectors.n1Threshold`; red paths
  `abc`/`0`/`-1`/`""`/`Infinity` → error naming
  `BACKEND_DOCTOR_PROBE_N1_THRESHOLD`. GREEN: `src/probe/options.ts`
  (constant + parsing) and `src/cli/commands/probe.ts` (raw env passthrough).

- [ ] **T2. Findings types + analysis sections (AC-11..AC-16).** RED:
  `tests/unit/probe/analysis.test.ts` — zero-state key sets with the three
  new sections; endpoint aggregation with pinned nearest-rank percentiles,
  tie-breaks, ascending-numeric statuses, cap + warning; N+1 warnings at /
  above / below threshold in endpoint order; db totals + unattributed +
  models order/cap; memory peaks + gc aggregation; byte-identical
  re-analysis; unknown event types ignored. GREEN: `src/probe/types.ts`
  (new event + findings interfaces, `n1Threshold` in
  `ProbeCollectorsSettings`) and `src/probe/analysis.ts`.

- [ ] **T3. Hook settings plumbing (AC-10, hook level).** RED:
  `tests/unit/probe/hook.test.ts` — attach's `collectors` block carries
  `n1Threshold` when the env carries three valid fields; malformed env stays
  lifecycle-only with one notice. Existing `COLLECTORS` constants updated
  (recorded consequence). GREEN: `src/probe/hook.ts` — `parseCollectors`
  validates `n1Threshold`, attach event includes it.

- [ ] **T4. Memory/GC collector (AC-5).** RED:
  `tests/unit/probe/hook.test.ts` — `mem-app.cjs` with a 150ms interval knob
  yields ≥ 2 `mem.sample` events with the four well-typed MB fields;
  `gc.pause` events, when present, carry `kind` ∈ known set and numeric
  `durationMs`; the host runs to completion (observer never keeps the loop
  alive). GREEN: `src/probe/hook.ts` — `installMemoryCollector` (own unref'd
  interval + PerformanceObserver, `entry.detail.kind`).

- [ ] **T5. HTTP collector (AC-1, AC-2, AC-6, AC-8).** RED:
  `tests/unit/probe/hook.test.ts` — `http-app.cjs`: `http.request` events
  for completed routes with route pattern (`/users/:id`) vs pathname
  fallback, method/status/durationMs/dbQueries shapes, no event for the
  aborted route; inert-mode marker probe: `http.Server.prototype.emit`
  stays native without the collectors env. GREEN: `src/probe/hook.ts` —
  `installHttpCollector` (ALS closure-applied emit wrap, route attribution,
  finish listener).

- [ ] **T6. DB collector (AC-3, AC-4, AC-7).** RED:
  `tests/unit/probe/hook.test.ts` — `prisma-app.cjs` + fake
  `node_modules/@prisma/client`: `db.query` events with model/action/
  attributed, per-request `dbQueries` counts (startup query
  `attributed: false`), CJS wrap; `prisma-app.mjs` — ESM named import wrap;
  `FAKE_PRISMA_NO_USE=1` — one notice, no `db.query`, http events keep
  flowing; inert-mode probe: the client class stays unwrapped without the
  collectors env. GREEN: `src/probe/hook.ts` — `installDbCollector`
  (`Module._load` interception, dual-form matching, subclass + `$use`
  middleware).

- [ ] **T7. CLI-level wiring (AC-9, AC-12, AC-15, AC-17, AC-18).** RED:
  `tests/e2e/probe.test.ts` — http session (exit 0, stdout passthrough,
  `findings.http` populated with the `/users/:id` endpoint, summary names
  the request count, `assertCommonSession` unchanged); prisma session
  (`db` totals + endpoint `dbQueries`); N+1 warning end-to-end with
  `BACKEND_DOCTOR_PROBE_N1_THRESHOLD=2`; invalid knob → exit 2, no session,
  empty stdout; not-node session → structural zero states for the three
  sections; findings key-set and collectors pins updated (recorded
  consequence). GREEN: `src/probe/runner.ts` — summary line gains the http
  request count.

- [ ] **T8. Close-out (no TDD).** Check off tasks; record deviations;
  move durable findings into `docs/RESEARCH.md` (ALS `this`-binding trap,
  ESM resolved-path form of `Module._load`, DEP0152 `entry.detail`,
  observer liveness, fixture `node_modules` needs `git add -f`); spec
  status → Implemented; `docs/PLAN.md` F020 → Done.

## Deviations & notes

_(filled during implementation)_
