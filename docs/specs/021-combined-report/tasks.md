# Tasks 021 — Combined report (static + runtime)

TDD order: characterization/config pins first, then RED→GREEN clusters ordered
by dependency (pure synthesis → loader → report doc → reporters → CLI → e2e),
close-out last.

- [ ] **T1. Config pins runtime ids as unknown (AC-15).** RED:
  `tests/unit/config/validate.test.ts` — cases naming
  `backend-doctor/runtime-blocking-call` and
  `backend-doctor/runtime-possible-n1` in `rules` and in `ignore.rules`,
  each rejected with the unknown-rule-id error. GREEN: none expected — the
  validation is already id-set-based; this task pins the contract
  (characterization test; if red, config validation regressed and must be
  fixed before anything else).

- [ ] **T2. Runtime diagnostic synthesis (AC-4, AC-5, AC-6, AC-7, AC-9,
  AC-14).** RED: `tests/unit/runtime/merge.test.ts` — hand-built findings
  documents (plain objects; no I/O): blocking row with relative `file`
  resolved against `sessionCwd`, absolute `file` kept as-is, null
  line/column → 1, exact message/rule/category/severity/tags, id equal to
  `createDiagnosticId` over the target-relative posix tuple (including the
  `../` form for an out-of-root culprit); N+1 at exactly the threshold and
  below it; N+1 message byte-equal to the F020 findings warning text and
  positioned at the findings.json path 1:1; one diagnostic per row present;
  empty findings → zero diagnostics; missing sections → zero diagnostics;
  same-site static diagnostic kept alongside; byte-identical re-render of
  the synthesized diagnostics through all three reporters. GREEN:
  `src/runtime/merge.ts`.

- [ ] **T3. Trace session loader (AC-1, AC-2).** RED:
  `tests/unit/runtime/load.test.ts` — happy load against a temp session dir
  (findings parsed, `sessionCwd` read, provenance `{ sessionDir: abs,
  traceSchemaVersion: 1 }`); every red path with its exact stderr reason:
  directory absent, path is a file, findings.json missing, findings.json
  invalid JSON, findings version ≠ 1, session.json missing, invalid, version
  ≠ 1, `session.cwd` not a string. GREEN: `src/runtime/load.ts`.

- [ ] **T4. Report provenance block (AC-12, AC-11).** RED:
  `tests/unit/report.test.ts` — `buildReport(result, provenance)` appends
  `runtime` as the last key; without it the key is absent;
  `exitCodeFor` re-pinned with runtime-shaped warns (0 on warn-only, 1 with
  a static error). GREEN: `src/core/types.ts` (`RuntimeProvenance`,
  `ReportDocument.runtime?`), `src/core/report.ts` (optional second
  parameter).

- [ ] **T5. Reporters render merged documents (AC-13, AC-14).** RED:
  `tests/unit/reporters.test.ts` — pretty renders `Runtime trace: <dir>` for
  a merged doc and renders a runtime diagnostic with its `../`-relative path,
  counted in the summary; jsonl emits runtime diagnostics lines in
  construction order; json byte-stability across renders. GREEN:
  `src/reporters/pretty.ts` (one additive line; json/jsonl untouched).

- [ ] **T6. Scan CLI wiring (AC-1, AC-2, AC-3, AC-11 CLI level).** RED:
  `tests/e2e/combined-report.test.ts` — `--trace` at a nonexistent dir and
  at a dir without findings.json → exit 2, empty stdout, stderr reason,
  report absent; scan without `--trace` → no `runtime` key (AC-3); warn-only
  merged scan exits 0. GREEN: `src/cli/run.ts` (`--trace <dir>` option),
  `src/cli/commands/scan.ts` (load before runScan → red path exit 2; merge +
  `sortDiagnostics` after; provenance into `buildReport`).

- [ ] **T7. Full-loop e2e against real probe sessions (AC-1, AC-5, AC-8,
  AC-10, AC-12, AC-13 CLI level).** RED: extend
  `tests/e2e/combined-report.test.ts` — probe `blocking.cjs` (threshold
  knob 1) then `scan <cwd> --trace <session> --format json`: exactly the
  `crypto.pbkdf2Sync` runtime diagnostic positioned at `<cwd>/blocking.cjs`
  (relative recording resolved via session.cwd), provenance block, exit 0,
  empty stderr; probe `prisma-app.cjs` (N1 knob 2) then scan → the `/bulk`
  N+1 diagnostic with the exact F020 warning text; merged ordering with the
  `bad-app` fixture tree (out-of-root runtime row first, then the four
  static warns by the global order); `--scope files --file src/index.ts
  --trace …` keeps runtime diagnostics while project rules are skipped
  visibly; jsonl and pretty formats on a merged scan. GREEN: expected
  already-green from T2–T6; fix whatever the real-loop surfaces.

- [ ] **T8. Close-out.** Check off tasks; record deviations; spec status →
  `Implemented`; `docs/PLAN.md` F021 → Done; verification suite
  (`pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm format`) and a
  live CLI smoke test.

## Deviations & notes

(appended during implementation)
