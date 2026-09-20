# Tasks 018 — Runtime probe runner (F018)

TDD order: build wiring (config-only) first, then the hook (tests spawn the
built artifact), pure modules that tests import, then the runner + CLI wiring,
lifetime control, and the e2e red paths. Every task: red → green → refactor,
commit per green task.

- [ ] **T1. Build wiring for the CJS hook entry (config-only — No TDD).**
      `tsup.config.ts`: `allBuildOptions` = existing ESM config + hook config
      (`entry: { "probe/register": "src/probe/hook.ts" }`, `format: ["cjs"]`,
      `outExtension: () => ({ js: ".cjs" })`, `clean: false`); default export
      becomes the array. `tests/globalSetup.ts` iterates the array. `.gitignore`
      gains `.backend-doctor/`. Verify `pnpm build` emits
      `dist/probe/register.cjs` and `pnpm test` still builds+passes (hook
      source may be a stub until T2).
- [ ] **T2. Probe hook: attach/detach, inert outside a session (AC-11).**
      RED: `tests/unit/probe/hook.test.ts` — spawn `node --require
      dist/probe/register.cjs <script>` (fixture `tests/fixtures/probe/ok.js`)
      without the session env: script output intact, one stderr notice, no
      events file written; with `BACKEND_DOCTOR_PROBE_EVENTS` pointing at a tmp
      file: `probe.attach` before script output ordering-wise, `probe.detach`
      after exit, both NDJSON-parseable with `type`/`timestamp`/`pid`, no crash
      on double require. GREEN: `src/probe/hook.ts` — standalone CJS source
      (no imports from `src/probe/*`), env-gated, `appendFileSync` per line,
      `process.on("exit")` detach, double-attach guard, first-append-failure →
      notice + inert.
- [ ] **T3. Pure option/session modules (AC-4 shape, AC-5, AC-6, AC-10 unit
      level).** RED: `tests/unit/probe/options.test.ts` (duration: valid /
      non-numeric / zero / negative; command presence; filter non-emptiness)
      and `tests/unit/probe/session.test.ts` (UTC stamp format; session dir
      under default root and `--out` root; uniqueness; existing-file root
      rejection; `buildSessionDoc` exact key set, `traceSchemaVersion: 1`,
      `exit` code and signal variants; tab-indent + trailing newline).
      GREEN: `src/probe/types.ts`, `src/probe/options.ts`, `src/probe/session.ts`,
      `src/probe/node-options.ts` (merge cases covered here).
- [ ] **T4. Runner happy path + CLI registration (AC-1, AC-2, AC-3, AC-4, AC-5,
      AC-6, AC-9).** RED: `tests/e2e/probe.test.ts` — `probe -- node ok.js`
      (exit 0, byte-identical stdout passthrough, empty probe stdout, warning
      + summary on stderr, session.json/events.ndjson as pinned, default
      location, two runs → distinct dirs), `fail.js` → exit 3 with
      `"exit": {"code": 3}` recorded; fixtures `ok.js`, `fail.js`, `long.js`,
      `descendant.js`, `envcheck.js`, `dummy-preload.cjs`; `NODE_OPTIONS` merge
      case (`envcheck.js` with preexisting preload). GREEN: `src/probe/runner.ts`
      (`runProbe`: hook check → session dir → warning → spawn → finalize →
      pass-through exit), `src/cli/commands/probe.ts`, `run.ts` registration.
- [ ] **T5. Duration expiry + signal forwarding (AC-7, AC-8).** RED: e2e
      `--duration 1` against `long.js` (bounded exit, `exit.signal ===
      "SIGINT"`, finalized session) and SIGINT sent to the probe pid (exit 130,
      session records the signal, child terminated). GREEN: escalation chain
      (SIGINT → SIGTERM → SIGKILL, 5s steps) and signal forwarding in
      `runner.ts`; handlers removed after finalize.
- [ ] **T6. Usage/environment red paths (AC-10).** RED: e2e — no `--`, empty
      command after `--`, `--duration abc`, `--duration 0`, `--out` at an
      existing file, hook file missing (rename/restore around the run): each
      exits 2, names the reason on stderr, writes nothing to stdout, creates no
      session directory, spawns nothing. GREEN: validation ordering in
      `options.ts`/`runner.ts` (validate before creating anything), spawn-error
      session-dir cleanup.
- [ ] **T7. Descendant process coverage (AC-12).** RED: e2e `descendant.js` —
      events.ndjson carries `probe.attach` for two distinct pids (parent +
      spawned node child) and their `probe.detach` lines. GREEN: expected to
      pass against the T4 implementation (characterization of `NODE_OPTIONS`
      propagation); a failure is a real injection bug to fix in `runner.ts`.
- [ ] **T8. Close-out.** Check off tasks, record deviations, spec status →
      `Implemented`, `docs/PLAN.md` F018 → `Done`, live CLI smoke test
      (`probe -- node` fixture scripts, duration run) with eyeballed output.

## Deviations & notes

(recorded during implementation)
