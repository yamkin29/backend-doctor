# Tasks 019 — Event loop & blocking attribution

TDD order: pure parsing/analysis first (things others import), then the hook
collectors (tested through the built artifact), then the runner finalize.

- **T1. Collector knob parsing (AC-15).** RED:
  `tests/unit/probe/options.test.ts` — defaults when env absent; valid values
  parsed; empty/NaN/negative threshold rejected; sub-50/NaN interval rejected;
  error messages name the env var and the raw value. GREEN:
  `src/probe/options.ts` (`collectors` in `ParsedProbeOptions`, defaults
  20/1000, min interval 50), `src/cli/commands/probe.ts` passes the raw
  `BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS` / `BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS`
  env values.

- **T2. Findings analysis, pure (AC-8, AC-9, AC-10, AC-11, AC-16).** RED:
  `tests/unit/probe/analysis.test.ts` — exact key sets of `findings.json`;
  aggregation by (api,file,line,column,function,asyncRootType) with
  totalMs-desc/file-asc/line-asc ordering; cap at 50 + warning; zero states
  structural; no-attach warning; malformed lines counted; loopLag merge (exact
  sums/max, weighted p50/p99, last-total-per-pid); byte-identical re-analysis.
  GREEN: `src/probe/types.ts` extensions, `src/probe/analysis.ts`.

- **T3. Loop-lag collector + activation channel (AC-1, AC-2, AC-14;
  existing e2e pins).** RED: `tests/unit/probe/hook.test.ts` — with events +
  collectors env: `probe.attach` carries the `collectors` block; a `loop.lag`
  event with `final: true` and a `total` block precedes `probe.detach`;
  periodic non-final windows against `spin.js` at interval 300; malformed
  collectors JSON → one notice, lifecycle-only events; events-env-only stays
  silent lifecycle-only. GREEN: `src/probe/hook.ts` lag collector (two
  histograms, unref'd interval, exit-flush before detach, try/catch);
  `src/probe/runner.ts` sets `BACKEND_DOCTOR_PROBE_COLLECTORS`; update the two
  e2e pins that assumed exactly two events (bracket assertions).

- **T4. Blocking-call collector (AC-3, AC-4, AC-5, AC-6).** RED:
  `tests/unit/probe/hook.test.ts` + fixtures `blocking.cjs`/`blocking.mjs` —
  `block.call` recorded for `crypto.pbkdf2Sync` (durationMs ≥ threshold) and
  big `fs.readFileSync`, with file/line/column/function attribution; the
  `.mjs` fixture proves ESM named-import visibility; inert hook leaves
  `readFileSync` native (`toString()`); no culprit is the hook bundle or a
  node internal; attach event's collectors block unchanged. GREEN:
  `src/probe/hook.ts` — wrapper table (fs/zlib `*Sync` iteration +
  `realpathSync.native`; explicit crypto/child_process lists), lazy stack
  formatting with scoped `prepareStackTrace`, culprit rule, async
  tagging (bounded map, root walk), re-entrancy guard in `writeEvent`,
  `Object.defineProperty` name preservation, per-collector disable-on-error.

- **T5. Record-time filter enforcement (AC-7).** RED:
  `tests/unit/probe/hook.test.ts` — `BACKEND_DOCTOR_PROBE_FILTERS` with a
  non-matching glob suppresses `block.call` while `loop.lag`/lifecycle still
  record; a matching glob records. GREEN: `src/probe/hook.ts` picomatch
  matchers compiled once at attach (culprit path relative-or-absolute as
  recorded); `src/probe/runner.ts` sets the filters env from
  `parsed.filters`.

- **T6. Finalize: findings.json + stderr summary (AC-8, AC-10, AC-12, AC-13,
  AC-15 CLI level).** RED: `tests/e2e/probe.test.ts` — blocking session in a
  tmp cwd (fixture copied in, 32MB file, threshold knob 1): exit 0 pass-through,
  `findings.json` with contract key set and top call at `blocking.cjs`, stderr
  summary naming findings.json, stdout untouched, `assertCommonSession` holds;
  `--filter` CLI level (no-match → `blocking.count === 0`, match → ≥ 1);
  `sh -c` not-node → zero-state findings + warning on stderr, exit 0; invalid
  knob env → exit 2, no session dir; spin + `--duration` → `loopLag.windows`
  ≥ 2. GREEN: `src/probe/runner.ts` finalize step (read events, build
  findings, write tab-indented `findings.json`, warnings + one summary line to
  stderr, loud-but-non-fatal analysis failure path).

- **T7. Close-out.** Live CLI smoke test on a deliberately blocking script
  (eyeball findings.json + stderr). Check boxes, record deviations, move
  durable findings into `docs/RESEARCH.md`, spec status → Implemented,
  `docs/PLAN.md` F019 → Done.

## Deviations & notes

_(filled at close-out)_
