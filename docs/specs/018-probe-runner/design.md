# Design 018 — Runtime probe runner (F018)

Approved spec: `spec.md` (2026-09-21). All OQs resolved by adopting the
recommendations.

## Module layout

| File | Purpose |
|------|---------|
| `src/probe/types.ts` | Trace contract types: `TRACE_SCHEMA_VERSION`, `ProbeSession`, `TraceDocument`, `ProbeExit`, event shapes. |
| `src/probe/options.ts` | Pure CLI-option parsing/validation: command presence, `--duration`, `--filter` non-emptiness. Returns a result union, no I/O. |
| `src/probe/session.ts` | Pure + fs helpers: UTC stamp, session-dir creation (`mkdtemp` under the storage root), `events.ndjson` creation, `buildSessionDoc()` and `writeSessionDoc()` (tab-indented JSON, mirroring `renderJson`). |
| `src/probe/node-options.ts` | Pure `buildNodeOptions(existing, hookPath)` — append `--require`, never clobber. |
| `src/probe/runner.ts` | `runProbe()`: hook-path check → session dir → warning → spawn (no shell, inherited stdios, merged env) → duration escalation + signal forwarding → await child exit → finalize → exit code. |
| `src/probe/hook.ts` | The preload itself: standalone (imported by nothing), built to `dist/probe/register.cjs`; attach/detach events, inert outside a session. |
| `src/cli/commands/probe.ts` | Thin command: parse options, write usage errors to stderr (exit 2), delegate to `runProbe`. |
| `src/cli/run.ts` | Registers the `probe` command (variadic `[command...]` after `--`, three flags). |
| `tsup.config.ts` | Split into the existing ESM config plus a CJS hook config (`outExtension: () => ({ js: ".cjs" })`); `allBuildOptions` array. |
| `tests/globalSetup.ts` | Iterates `allBuildOptions` (array-aware) so vitest builds the hook entry like every other entry. |
| `.gitignore` | Adds `.backend-doctor/` (OQ-2 resolution). |
| `tests/fixtures/probe/*.js` | Plain-`node` fixture scripts: `ok.js`, `fail.js`, `long.js`, `descendant.js`, `envcheck.js`, `dummy-preload.cjs`. |
| `tests/unit/probe/*.test.ts` | Options, session, node-options unit tests. |
| `tests/e2e/probe.test.ts` | The whole command against the built bin. |

## Key decisions

1. **The hook ships as CJS via a second tsup config.** `--require` cannot load
   ESM, and Node 20 (our declared floor) cannot `require()` ESM at all —
   require-ESM is only reliably available from Node ≥ 22.12. Under
   `"type": "module"` a `.js` build would be ESM regardless of content, so the
   hook entry gets `format: ["cjs"]` + `outExtension: () => ({ js: ".cjs" })` →
   `dist/probe/register.cjs`. Alternative: a single ESM entry injected via
   `--import` — rejected: the constitution (§7) and the PLAN name `--require`,
   and `--import` in `NODE_OPTIONS` narrows the supported Node range. Consequence:
   `buildOptions` becomes an array (`allBuildOptions`) and `globalSetup.ts`
   iterates it — the spec 017 precedent ("second tsup entries need no wiring")
   then builds the hook on every test run automatically.
2. **Injection appends to `NODE_OPTIONS` rather than rewriting the command.**
   Direct `node --require …` rewriting only works when the command *is* node;
   `backend-doctor probe -- npm run dev` must work, and preload propagation to
   descendant node processes is a feature (AC-12, whole-process-tree coverage).
   The existing value is preserved verbatim, our directive appended
   (space-separated, path double-quoted — `NODE_OPTIONS` supports quoting).
   Alternative rejected: writing a wrapper script — that is a file write in the
   user's tree (§7 violation).
3. **Two-file session storage.** `events.ndjson` is created empty at session
   start and appended by hook processes (one JSON line per `write`, `O_APPEND`
   → line-atomic on POSIX even with concurrent descendants); `session.json` is
   written once at finalize by the parent. Alternative: one `trace.json` at
   finalize — rejected: a SIGKILLed child (duration escalation step 3) would
   lose everything recorded so far; the append-only file survives crashes, and
   `session.json`'s `exit` field is the authoritative "how it ended".
4. **The parent owns all lifetime control; the hook is dumb.** Duration timing,
   signal forwarding and escalation live in `runProbe()` (SIGINT → SIGTERM →
   SIGKILL, fixed 5s grace steps; `os.constants.signals` maps signal → exit
   `128 + n`). Alternative: a timer inside the hook — rejected: leaving timers
   behind in the user's process is intrusion, and the parent already owns
   process control.
5. **The hook installs no signal handlers.** `probe.detach` is written from a
   `process.on("exit")` listener, which fires on normal exit, `process.exit()`
   and fatal errors — but not on default-disposition signal death. A
   signal-killed child therefore has no `detach` line; that is documented and
   intentional: the authoritative record is `session.json`'s
   `exit: { signal }`. Alternative: hook-side SIGINT/SIGTERM handlers with
   re-raise — rejected: installing handlers changes the app's signal semantics
   (§7 intrusion), and safe re-raise without stealing the app's own handlers is
   not implementable (removing listeners would break the app; not re-raising
   swallows the signal).
6. **Exit codes (OQ-1).** `runProbe` returns: the child's exit code
   (pass-through, 0–255); `128 + signum` when the child died by signal (whether
   from duration escalation or forwarded probe signal); `2` for usage errors
   (no/empty command, bad `--duration`, `--out` at a file) and environment
   errors (hook file missing, spawn failure). Spawn failure additionally removes
   the just-created session directory, so a failed probe leaves no trace
   directories behind. AC-10's "no session directory" is honored by validating
   everything *before* creating it, and by the spawn-error cleanup.
7. **`--filter` is metadata in F018 (OQ-3).** Stored verbatim (non-empty
   strings) into `session.json.filters`; no glob compilation yet — the
   collectors that must honor it do not exist until F019. Validating globs now
   with picomatch would be a contract with no behavior to pin it to.
8. **The hook is inert, never fatal (§8 vs §7).** Outside a session (no
   `BACKEND_DOCTOR_PROBE_EVENTS` env) it writes one stderr notice and does
   nothing; append failures write one notice and go inert. Crashing or altering
   the host app to "fail loud" would violate §7's zero-intrusion, which wins
   for code running inside the user's process; loudness is the parent's job.
9. **The hook is a standalone entry with no imports from `src/probe/*`.**
   tsup bundles the import graph of each entry; importing shared types from the
   runner would drag the hook source into `dist/bin/backend-doctor.js` too.
   Types are duplicated minimally in `hook.ts` (a comment ties them to
   `src/probe/types.ts`).
10. **`session.json` is tab-indented** like `renderJson` (`JSON.stringify(doc,
    null, "\t")` + newline) — it is a file humans read, unlike the piped report.
11. **`--out` creates the root with `mkdirSync(…, { recursive: true })`;**
    the error path is only an existing *non-directory* (checked explicitly —
    `mkdirSync` would throw `EEXIST`/`ENOTDIR` with an unfriendly message).

## Dependencies

None added (OQ-4). Everything is `node:child_process`, `node:fs`, `node:os`,
`node:path`, `node:process`, `node:url`.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/e2e/probe.test.ts` happy run (exit = child's, stdios inherited, `NODE_OPTIONS` merge via `envcheck.js` + `dummy-preload.cjs`); unit `buildNodeOptions` cases |
| AC-2 | e2e: probe stdout empty on success and on every AC-10 red path; `ok.js` output byte-identical |
| AC-3 | e2e: warning on stderr before child output, names session dir, "never sent anywhere", gitignore hint |
| AC-4 | e2e: parse `session.json` (exact key set, `traceSchemaVersion: 1`, `exit.code`) + `events.ndjson` (attach then detach, ordered timestamps); unit `buildSessionDoc` both `exit` variants |
| AC-5 | e2e default location + `--out` relocation; unit `createSessionDir` |
| AC-6 | e2e two runs → distinct dirs; unit mkdtemp uniqueness |
| AC-7 | e2e `--duration 1` vs `long.js`: bounded exit, `exit.signal === "SIGINT"`, session finalized |
| AC-8 | e2e SIGINT to the probe pid → exit 130, session records forwarded signal |
| AC-9 | e2e `ok.js` → 0, `fail.js` → 3, `session.json` records the code |
| AC-10 | unit `parseProbeOptions` red paths + `--out`-at-file; e2e every red path (exit 2, stderr reason, empty stdout, no session dir); hook-file-missing via rename/restore |
| AC-11 | hook integration: no-env → notice + no events + host runs; events are NDJSON with `type`/`timestamp`/`pid` (unit event-line assertions in e2e) |
| AC-12 | e2e `descendant.js`: two attaches with distinct pids (and two detaches) in one `events.ndjson` |

Determinism guard: all assertions exclude timestamps, durations and session-id
randomness (format checked by regex, not value).
