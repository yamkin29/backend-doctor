# Tasks 009 — Nest DI rules

TDD order: model/extraction first (tests read the model), then pure graph
helpers, then rules (each: fixtures + exact-diagnostics test → rule → docs →
registration), then pipeline/e2e, close-out last.

- **T1. Model extensions + extraction (AC-1..5).** RED: extend
  `tests/unit/framework/nest-model.test.ts` with the
  `tests/fixtures/nest/di-rules/model-extensions/` tree (scope variants,
  injections incl. `forwardRef`/`@Optional`, `@Global`, `hasUnresolved` via
  `useValue`/`useFactory`, `{ module: X }` import) — assert the full extended
  model. GREEN: `model.ts` fields; `extract.ts` (constructor injection reader,
  scope reader, `global`, per-module `hasUnresolved`, `module` key capture);
  `parser/types.ts` type-only re-exports (`ConstructorDeclaration`,
  `ParameterDeclaration`). Refactor: keep `readModule` push sites setting the
  flag in one place.
- **T2. DI graph helpers (AC-7/8 machinery).** RED:
  `tests/unit/rules/di-graph.test.ts` over hand-built models — component
  detection (pair, three-node, self-loop, acyclic), canonical member + path
  determinism, closing edge selection, `hasForwardRef`; resolvability walk
  (direct provide, transitive export, `@Global` export, unknown import name
  fail-open, `hasUnresolved` fail-open, re-export-only owner,
  multi-owning-module rule). GREEN: `src/rules/nest/di-graph.ts`.
- **T3. `provider-not-registered` (AC-6, AC-7 end-to-end, AC-14).** RED:
  `tests/unit/rules/nest-di.test.ts` describe block over
  `di-rules/provider-not-registered/{valid,invalid}` with exact diagnostics +
  docs-path assertion. GREEN: `src/rules/nest/provider-not-registered.ts`,
  `docs/rules/backend-doctor/provider-not-registered.md`, register in
  `src/rules/index.ts`, registry-count assertion 16 → 17.
- **T4. `circular-di` (AC-8, AC-14).** RED: fixtures
  `di-rules/circular-di/{valid,invalid}` + exact diagnostics (forwardRef pair,
  three-node cycle, self-loop; canonical-file filter). GREEN: rule, docs,
  registration, count 17 → 18.
- **T5. `missing-forward-ref` (AC-9, AC-14).** RED: fixtures
  `di-rules/missing-forward-ref/{valid,invalid}` + exact diagnostics (closing
  edge; forwardRef pair silent). GREEN: rule, docs, registration, count
  18 → 19.
- **T6. `request-scoped-in-singleton` (AC-10, AC-14).** RED: fixtures
  `di-rules/request-scoped-in-singleton/{valid,invalid}` + exact diagnostics
  (provider and controller consumers; request-scoped/transient/plain silent).
  GREEN: rule, docs, registration, count 19 → 20.
- **T7. Gate + model-absent safety in the pipeline (AC-11).** RED: unit — each
  DI rule no-ops when `RuleContext.nest` is absent; integration — non-nest
  tree yields no DI diagnostics; nest tree yields them through `runScan`.
  GREEN: no production change expected (gate exists since F004/F008) — if a
  gap appears, fix the engine and record the deviation.
- **T8. e2e through the bin (AC-12, AC-13).** RED:
  `tests/e2e/nest-di-rules.test.ts` — findings in JSON from the real bin,
  two scans byte-identical, config override `off`/`error` with exit codes
  0/1, jsonl diagnostics-only purity, stderr empty. GREEN: no production
  change expected; fix engine/reporters only if a gap appears (record it).
- **T9. Close-out.** Check off tasks, record deviations in this file, append
  durable ts-morph findings to `docs/RESEARCH.md`, spec status → Implemented,
  `docs/PLAN.md` F009 → Done. Final full verify (`pnpm test`,
  `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm format`) and live CLI smoke.

## Deviations & notes

_(filled during implementation)_
