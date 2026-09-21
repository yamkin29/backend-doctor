# Tasks 019 — Event loop & blocking attribution

TDD order: pure parsing/analysis first (things others import), then the hook
collectors (tested through the built artifact), then the runner finalize.

- [x] **T1. Collector knob parsing (AC-15).** RED:
  `tests/unit/probe/options.test.ts` — defaults when env absent; valid values
  parsed; empty/NaN/negative threshold rejected; sub-50/NaN interval rejected;
  error messages name the env var and the raw value. GREEN:
  `src/probe/options.ts` (`collectors` in `ParsedProbeOptions`, defaults
  20/1000, min interval 50), `src/cli/commands/probe.ts` passes the raw
  `BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS` / `BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS`
  env values.
- [x] **T2. Findings analysis, pure (AC-8, AC-9, AC-10, AC-11, AC-16).** RED:
  `tests/unit/probe/analysis.test.ts` — exact key sets of `findings.json`;
  aggregation by (api,file,line,column,function,asyncRootType) with
  totalMs-desc/file-asc/line-asc ordering; cap at 50 + warning; zero states
  structural; no-attach warning; malformed lines counted; loopLag merge (exact
  sums/max, weighted p50/p99, last-total-per-pid); byte-identical re-analysis.
  GREEN: `src/probe/types.ts` extensions, `src/probe/analysis.ts`.
- [x] **T3. Loop-lag collector + activation channel (AC-1, AC-2, AC-14;
  existing e2e pins).** RED: `tests/unit/probe/hook.test.ts` — with events +
  collectors env: `probe.attach` carries the `collectors` block; a `loop.lag`
  event with `final: true` and a `total` block precedes `probe.detach`;
  periodic non-final windows against `spin.cjs` at interval 300; malformed
  collectors JSON → one notice, lifecycle-only events; events-env-only stays
  silent lifecycle-only. GREEN: `src/probe/hook.ts` lag collector (two
  histograms, explicit `enable()`, unref'd interval, exit-flush before detach,
  try/catch); `src/probe/runner.ts` sets `BACKEND_DOCTOR_PROBE_COLLECTORS`;
  the two e2e pins that assumed exactly two events became bracket assertions.
- [x] **T4. Blocking-call collector (AC-3, AC-4, AC-5, AC-6).** RED:
  `tests/unit/probe/hook.test.ts` + fixtures `blocking.cjs`/`blocking.mjs` —
  `block.call` recorded for `crypto.pbkdf2Sync` and a big `fs.readFileSync`,
  with file/line/column/function attribution; the `.mjs` fixture proves ESM
  named-import visibility; inert hook leaves `readFileSync` unpatched (marker
  check); no culprit is the hook bundle or a node internal. GREEN:
  `src/probe/hook.ts` — wrapper table (fs/zlib `*Sync` iteration +
  `realpathSync.native`; explicit crypto/child_process lists), lazy stack
  formatting with scoped `prepareStackTrace`, culprit rule, async
  tagging (bounded map, root walk), re-entrancy guard in `writeEvent`,
  name preservation + non-enumerable wrapper marker, per-collector
  disable-on-error.
- [x] **T5. Record-time filter enforcement (AC-7).** RED:
  `tests/unit/probe/hook.test.ts` — `BACKEND_DOCTOR_PROBE_FILTERS` with a
  non-matching glob suppresses `block.call` while `loop.lag`/lifecycle still
  record; a matching glob records. GREEN: `src/probe/hook.ts` picomatch
  matchers compiled once at attach (culprit path relative-or-absolute as
  recorded); `src/probe/runner.ts` sets the filters env from
  `parsed.filters`.
- [x] **T6. Finalize: findings.json + stderr summary (AC-8, AC-10, AC-12,
  AC-13, AC-15 CLI level).** RED: `tests/e2e/probe.test.ts` — blocking session
  in a tmp cwd (fixture copied in, threshold knob 1): exit 0 pass-through,
  `findings.json` with contract key set and top call at `blocking.cjs`, stderr
  summary naming findings.json, stdout untouched, `assertCommonSession` holds;
  `--filter` CLI level (no-match → `blocking.count === 0`, match → ≥ 1);
  `sh -c` not-node → zero-state findings + warning on stderr, exit 0; invalid
  knob env → exit 2, no session dir; `spin.cjs` + `--duration` →
  `loopLag.windows` ≥ 2. GREEN: `src/probe/runner.ts` finalize step (read
  events, build findings, write tab-indented `findings.json`, warnings + one
  summary line to stderr, loud-but-non-fatal analysis failure path).
- [x] **T7. Close-out.** Live CLI smoke test run against a demo app with a
  deliberately blocking `users.service.js` — findings attribute
  `crypto.pbkdf2Sync` to `users.service.js:4:21 in findAll` (3 calls,
  94.8ms total). Check boxes, record deviations, durable findings moved to
  `docs/RESEARCH.md`, spec status → Implemented, `docs/PLAN.md` F019 → Done.

## Deviations & notes

1. **Fixtures are `.cjs`, not `.js`.** The spec's testing strategy said
   "plain `.js`/`.mjs` fixtures run by plain `node`" — but this repository's
   `package.json` carries `"type": "module"`, so a `.js` fixture using
   `require()` dies with "require is not defined in ES module scope" (bit in
   T3; the spec 014 test-shape precedent in reverse). `spin.js` became
   `spin.cjs`; `blocking.cjs` was `.cjs` from the start. Spec wording
   corrected at close-out.
2. **Core functions are JS, not native.** The planned inertness check —
   `readFileSync.toString()` containing `[native code]` — is impossible:
   `fs.readFileSync` is a JS function from `lib/fs.js` (only the binding
   layer is native), so its `toString()` is source code. Replaced with a
   non-enumerable marker property on wrappers
   (`__backendDoctorProbeWrapped`), asserted via `inert`/`patched` spawns.
3. **`monitorEventLoopDelay` needs an explicit `enable()`.** On Node
   22.13.1 (macOS/arm64), a freshly created IntervalHistogram records
   nothing: `count`/`max` stay 0 and every percentile returns the constant
   511ns floor bucket — with or without load. After `enable()` (returns
   `true`), values are sane. Both histograms now call `enable()` in T3's
   implementation (landed in the T6 commit, found by the e2e lag test).
   Relatedly, window `count` can still be 0 in live processes; tests pin
   field types, and only the e2e bounded-session test asserts positive
   counts.
4. **One flaky full-suite run.** Immediately after the T6 work, one full
   `pnpm test` run failed 4 hook tests (attribution, ESM, inert, malformed
   collectors) while the targeted probe runs were green; two consecutive
   full re-runs passed 665/665. No local reproduction since; the failing
   assertions are not timing-threshold dependent, so the suspicion is
   worker-load interference around the many spawned `node --require`
   processes. Watched, not yet actionable.
5. **Existing e2e pins**: exactly the two predicted pins needed updating
   (`toHaveLength(2)` in "runs the app instrumented", `events[1]` in "passes
   the child exit code"). The three unit hook pins stayed green because
   those tests run without the collectors env — silent lifecycle-only mode
   (design decision 8) kept them valid; the spec's "four pins" wording was
   corrected.
