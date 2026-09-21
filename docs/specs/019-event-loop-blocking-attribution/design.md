# Design 019 — Event loop & blocking attribution

## Module layout

| File | Purpose |
|------|---------|
| `src/probe/types.ts` | extend: `ProbeCollectorsSettings`, `ProbeAsyncTag`, `ProbeBlockCallEvent`, `ProbeLoopLagEvent`, `FindingsDocument` family; `ProbeAttachEvent` gains optional `collectors` |
| `src/probe/options.ts` | parse/validate the two collector knobs (raw env strings → `ParsedProbeOptions.collectors`, defaults applied) |
| `src/cli/commands/probe.ts` | pass raw `BACKEND_DOCTOR_PROBE_*` env values into `parseProbeOptions` |
| `src/probe/hook.ts` | the collectors: lag monitor, sync-API instrumentation with stack attribution, async tagging, record-time filtering, final flush; stays a self-contained standalone CJS entry (mirrors `types.ts` by hand) |
| `src/probe/analysis.ts` | NEW pure module: `buildFindings({ sessionId, collectors, eventsText })` → `FindingsDocument` |
| `src/probe/runner.ts` | set `BACKEND_DOCTOR_PROBE_COLLECTORS` / `BACKEND_DOCTOR_PROBE_FILTERS` in the child env; at exit read events, build + write `findings.json`, print summary/warnings to stderr |
| `tests/unit/probe/options.test.ts` | knob parsing red paths |
| `tests/unit/probe/analysis.test.ts` | NEW: pure findings analysis |
| `tests/unit/probe/hook.test.ts` | collector integration (built `register.cjs`) |
| `tests/e2e/probe.test.ts` | CLI-level findings, filters, not-node, invalid knobs, lag windows |
| `tests/fixtures/probe/blocking.cjs`, `blocking.mjs`, `spin.js` | deliberately blocking fixtures, run by plain `node` |

No build changes: `picomatch` bundles into the existing `register.cjs` hook
entry automatically (the hook config has no `external`), and the analysis ships
inside the existing bin bundle.

## Key decisions

1. **Sync-API instrumentation over a sampling profiler** (spec OQ-2, adopted).
   Wrapping known sync blocking APIs yields deterministic `file:line`
   attribution with zero intrusion; a V8/inspector sampling profiler would
   catch CPU spin loops but is intrusive, complex, and not in any PLAN line.
   Documented recall hole: pure spin loops and native blockers surface only as
   `loop.lag` windows without a culprit.
2. **Two `monitorEventLoopDelay` histograms per process** (window + cumulative
   `total`). The window histogram resets after each flush (temporal
   distribution); the total histogram never resets, so even a process killed
   before its second window still reports exact cumulative percentiles in its
   last event. Alternatives rejected: windows only (percentiles of the whole
   session would be an average of averages) and total only (no when-did-it-happen
   signal).
3. **Stack captured at call entry, formatted lazily.** The stack must predate
   the blocking call, so `Error.captureStackTrace(holder, wrapped)` runs on
   every instrumented call (cheap — no formatting); formatting into structured
   `CallSite`s happens only when the call turns out slow, by setting
   `Error.prepareStackTrace` and restoring it within the same synchronous
   block — it is never left patched (§7). Alternative rejected: formatting
   eagerly per call (string building on hot paths).
4. **Culprit selection:** first frame outside node internals **and**
   `node_modules`; fall back to the first frame outside node internals. The
   hook's own frames are cropped by `captureStackTrace(holder, wrapped)` and,
   belt-and-suspenders, frames ending in `register.cjs` are skipped. A block
   with no attributable frame at all is not recorded (practically unreachable).
5. **Aggregation key includes `asyncRootType`.** The same call site blocking
   under `SERVER` roots vs `TIMER` roots is analytically different (request
   path vs startup/timer), so it is deliberately two rows. Alternative
   (most-frequent-root per site) hides that split.
6. **`loopLag` merge:** per pid, take the `total` of its last `loop.lag`
   event; across pids sum `count`, take exact `maxMs`, and compute
   count-weighted averages for p50/p99. Naively merging every event would
   double-count windows against finals. Percentiles cannot merge exactly
   across processes — the weighted average is a documented, deterministic
   approximation.
7. **Filters enforced at record time inside the hook** (picomatch, bundled),
   matching the F018 contract wording "collector-restriction set". Dropped
   events are by design and visible via `session.filters`; no drop counter
   (§8 governs failures, not deliberate restrictions). Alternative (filter at
   analysis time) would leak non-matching events into the trace file.
8. **Collectors activate on `BACKEND_DOCTOR_PROBE_COLLECTORS` presence**, set
   by the parent from validated knobs. Absent = lifecycle-only mode, silent —
   a hand-rolled lifecycle-only attach is a legitimate F018 mode and its
   stderr-empty assertion stays green. Present but malformed = one notice +
   lifecycle-only (fail loud for a real misconfiguration).
9. **findings capped at 50 groups** with a `warnings` entry when capped —
   bounded file size; `blocking.count`/`totalMs` stay the full uncapped truth.
10. **Numbers:** durations/percentiles are rounded to 3 decimals at event
    write time; weighted percentile merges and sums re-round to 3 decimals so
    `findings.json` bytes stay stable and short; the human summary line rounds
    to 1 decimal. Aggregates keep insertion-order stability plus a full
    comparator tie-break chain (totalMs desc, file asc, line asc, then
    column/function/rootType) so equal-total rows still sort deterministically.
11. **The hook stays one self-contained file** (F018 decision 9): no imports
    from `src/probe/*`, event shapes mirrored by hand. It grows to ~300 lines;
    splitting into a second bundled file would blur the "standalone entry"
    boundary for no testability gain (collectors are tested through the built
    artifact).
12. **Exit-handler discipline:** the final lag flush runs inside try/catch
    before the `probe.detach` write; everything in the exit listener is
    synchronous, and a flush failure can never change the app's exit.
13. **Wrapper hygiene:** `Object.defineProperty(wrapped, "name", …)` preserves
    the original function name (libraries introspect names); `this`, args,
    returns and throws pass through unchanged; a re-entrancy flag makes the
    hook's own `appendFileSync` writes invisible to the collector. fs/zlib are
    patched by iterating function-valued exports whose name ends in `Sync`
    (plus the nested `realpathSync.native`); crypto/child_process use explicit
    lists (sign/verify/randomBytes are not `*Sync`-named).
14. **Analysis failure is loud and non-fatal:** if reading events or building
    findings throws at finalize, the probe prints the reason to stderr and
    still finalizes with the child's exit code (AC-13; findings never affect
    exit codes).

## Dependencies

None new. `picomatch` (runtime dep since F002) bundles into the hook;
`perf_hooks` / `async_hooks` are node core.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/unit/probe/hook.test.ts` — "collectors: final loop.lag precedes detach; attach carries the collectors block" |
| AC-2 | `tests/unit/probe/hook.test.ts` — "collectors: periodic lag windows" (interval 300ms against `spin.js`); e2e "lag windows under --duration" |
| AC-3 | `tests/unit/probe/hook.test.ts` — "blocking: block.call recorded with attribution" (`blocking.cjs`, `pbkdf2Sync` + big `readFileSync`) |
| AC-4 | `tests/unit/probe/hook.test.ts` — "blocking: ESM named imports are attributed" (`blocking.mjs`) |
| AC-5 | `tests/unit/probe/hook.test.ts` — "inert hook leaves core functions native" (`toString()` check) + existing inert tests |
| AC-6 | `tests/unit/probe/hook.test.ts` — "blocking: never attributes the hook bundle or node internals" |
| AC-7 | `tests/unit/probe/hook.test.ts` — "filters: non-matching block.call suppressed at record time"; e2e `--filter` test |
| AC-8 | `tests/unit/probe/analysis.test.ts` — structure/key sets/zero states; e2e "findings.json written" |
| AC-9 | `tests/unit/probe/analysis.test.ts` — aggregation, ordering, tie-breaks, cap |
| AC-10 | `tests/unit/probe/analysis.test.ts` — no-attach warning; e2e `sh -c` not-node test |
| AC-11 | `tests/unit/probe/analysis.test.ts` — malformed-line counting |
| AC-12 | e2e — stderr summary names findings.json, stdout stays empty |
| AC-13 | e2e — blocking session reuses `assertCommonSession`; `fail.js` still exits 3 |
| AC-14 | `tests/unit/probe/hook.test.ts` — malformed collectors JSON → one notice, lifecycle-only |
| AC-15 | `tests/unit/probe/options.test.ts` — knob red paths; e2e invalid knob → exit 2, no session |
| AC-16 | `tests/unit/probe/analysis.test.ts` — byte-identical re-analysis |

Existing-test consequences (recorded in spec): e2e "runs the app instrumented"
and "passes the child exit code" must stop pinning `toHaveLength(2)` /
`events[1]` because the parent-set collectors legitimately add a final
`loop.lag` line; they become bracket assertions (attach first, detach last).
Unit hook tests keep passing unchanged — they run without the collectors env
(lifecycle-only mode is silent, decision 8).
