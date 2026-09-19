# Tasks 004 — Framework detection (F004)

TDD order: adapter surface first (detection consumes it), then the pure
detection function, then the gate, then pipeline wiring, reporters, e2e,
close-out. Every task red → green → refactor; only green states are committed.

- [ ] **T1. Module specifiers on `SourceFileView` (AC-5).** RED: unit
  `tests/unit/engine/parser/ts-morph-adapter.test.ts` — a file with a static
  import, a `require("…")` call and a dynamic `import("…")` yields all three
  specifiers; a file without imports yields `[]`; string literals that are not
  module references are not collected. GREEN: `getModuleSpecifiers()` on the
  `SourceFileView` interface and the ts-morph adapter; compile fix: `FakeView`
  in `runner.test.ts` implements the new method.
- [ ] **T2. Detection matrix as data + pure `detectFrameworks` (AC-1..8, AC-12).**
  RED: unit `tests/unit/framework/detect.test.ts` — every matrix cell on temp
  trees: deps per framework (AC-1..4), file marker `prisma/schema.prisma`
  (AC-4), import-only activation without package.json (AC-5), empty result
  (AC-6), dedup + alphabetical sort (AC-7), unreadable/malformed package.json →
  `skippedChecks` entry + markers still work (AC-8), non-marker packages
  activate nothing (AC-12). GREEN: `src/framework/markers.ts`,
  `src/framework/detect.ts`.
- [ ] **T3. Rule-pack gate (AC-9, AC-10, AC-11).** RED: unit
  `tests/unit/engine/runner.test.ts` — rule with `frameworks` not run when a
  framework is undetected, run when all are detected; rule without the field
  unaffected; config severity entry on a gated rule produces no diagnostics and
  no crash; registry accepts `frameworks` on `defineRule`. GREEN:
  `RuleDefinition.frameworks?`, `RunRulesOptions.detectedFrameworks` (required),
  gate check first in the rule loop; update the test `run()` helper.
- [ ] **T4. Wire detection into `runScan` (AC-1..8 end-to-end).** RED:
  integration `tests/integration/scan.test.ts` — temp project with an `express`
  dependency: `projects[0].frameworks` equals `["express"]` and an import-only
  marker works; malformed package.json → `frameworks: []` plus a
  `framework-detection` skippedChecks entry. GREEN: `src/core/scan.ts` —
  hoist `findPackageRoot`, call `detectFrameworks`, merge its `skippedChecks`
  after the read failures, fill `projects[0].frameworks`.
- [ ] **T5. Pretty reporter frameworks line (AC-14).** RED: unit
  `tests/unit/reporters.test.ts` — a report with `frameworks: ["nest",
  "prisma"]` renders a `Frameworks: nest, prisma` line under `Directory:`; an
  empty frameworks list renders no line. GREEN: `src/reporters/pretty.ts`.
- [ ] **T6. e2e contract through the bin (AC-13, AC-14).** Tests:
  `tests/e2e/framework.test.ts` — temp app with an express dependency and an
  eval: json `projects[0].frameworks` equals `["express"]`, schemaVersion and
  exit-code policy unchanged, jsonl shape unchanged; config with a pack-style
  severity entry accepted (stderr empty); two consecutive runs byte-identical.
  Written after T4's wiring — expected green on first run (validation task);
  record in deviations if not.
- [ ] **T7. Close-out.** Live CLI smoke test on a temp Nest-ish app (pretty +
  json eyeballed). Check off tasks, record deviations, spec status →
  `Implemented`, `docs/PLAN.md` F004 → `Done`. Commit.

## Deviations & notes

_(filled during implementation)_
