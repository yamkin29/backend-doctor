# Tasks 009 — Nest DI rules

TDD order: model/extraction first (tests read the model), then pure graph
helpers, then rules (each: fixtures + exact-diagnostics test → rule → docs →
registration), then pipeline/e2e, close-out last.

- [x] **T1. Model extensions + extraction (AC-1..5).** RED: extend
	`tests/unit/framework/nest-model.test.ts` with the
	`tests/fixtures/nest/di-rules/model-extensions/` tree (scope variants,
	injections incl. `forwardRef`/`@Optional`, `@Global`, `hasUnresolved` via
	`useValue`/`useFactory`, `{ module: X }` import) — assert the full extended
	model. GREEN: `model.ts` fields; `extract.ts` (constructor injection reader,
	scope reader, `global`, per-module `hasUnresolved`, `module` key capture);
	`parser/types.ts` type-only re-exports. Refactor: unresolved push sites set
	the flag where they occur.
- [x] **T2. DI graph helpers (AC-7/8 machinery).** RED:
	`tests/unit/rules/di-graph.test.ts` over hand-built models — component
	detection (pair, three-node, self-loop, acyclic), canonical member + path
	determinism, closing edge selection, `hasForwardRef`; resolvability walk
	(direct provide, transitive export, `@Global` export, unknown import name
	fail-open, `hasUnresolved` fail-open, re-export-only owner,
	multi-owning-module rule). GREEN: `src/rules/nest/di-graph.ts`.
- [x] **T3. `provider-not-registered` (AC-6, AC-7 end-to-end, AC-14).** RED:
	`tests/unit/rules/nest-di.test.ts` describe block over
	`di-rules/provider-not-registered/{valid,invalid}` with exact diagnostics +
	docs-path assertion. GREEN: rule, doc, registration, registry count 16 → 17.
- [x] **T4. `circular-di` (AC-8, AC-14).** RED: fixtures
	`di-rules/circular-di/{valid,invalid}` + exact diagnostics (forwardRef pair,
	three-node cycle, self-loop; canonical-file filter). GREEN: rule, doc,
	registration, count 17 → 18.
- [x] **T5. `missing-forward-ref` (AC-9, AC-14).** RED: fixtures
	`di-rules/missing-forward-ref/{valid,invalid}` + exact diagnostics (closing
	edge; forwardRef pair silent). GREEN: rule, doc, registration, count
	18 → 19.
- [x] **T6. `request-scoped-in-singleton` (AC-10, AC-14).** RED: fixtures
	`di-rules/request-scoped-in-singleton/{valid,invalid}` + exact diagnostics
	(provider and controller consumers; request-scoped/transient/plain silent).
	GREEN: rule, doc, registration, count 19 → 20.
- [x] **T7. Gate + model-absent safety in the pipeline (AC-11).** RED: unit —
	each DI rule no-ops when `RuleContext.nest` is absent; integration — a nest
	tree yields the three expected diagnostics through `runScan`, a non-nest
	tree yields none. GREEN: no production change needed — the F004/F008 gate
	and the rules' `ctx.nest` guards already cover every path (prediction held).
- [x] **T8. e2e through the bin (AC-12, AC-13).** RED:
	`tests/e2e/nest-di-rules.test.ts` — findings in JSON from the real bin
	(incl. the wiring block), two scans byte-identical, severity override
	`off`/`error` with exit codes 0/1, jsonl diagnostics-only, stderr empty.
	GREEN: no production change needed.
- [x] **T9. Close-out.** Tasks checked, deviations recorded below, durable
	ts-morph findings appended to `docs/RESEARCH.md`, spec status →
	Implemented, `docs/PLAN.md` F009 → Done. Full verify + live CLI smoke.

## Deviations & notes

- **T1:** `ConstructorDeclaration` and `TypeNode` re-exports turned out
  unnecessary — type inference covers `cls.getConstructors()[0]` and
  `parameter.getTypeNode()`; only `ParameterDeclaration` was added to
  `parser/types.ts`. The spec's testing strategy predicted a larger growth;
  smaller is better (constitution §4 surface stays minimal).
- **T1:** hand-counted fixture coordinates were off twice (injection lines are
  6, not 5 — class lines start at the decorator; the factory element column is
  34). Re-pinned from the first failing run per the spec 007 method; no
  product change.
- **T2 (real bug caught by TDD):** the first resolvability BFS accepted a
  provider from an *imported* module's `providers` list. Nest semantics: only
  the owning module's own providers satisfy an injection; imported modules
  contribute their **exports** (transitively). Fixed in `reachableFrom`, then
  pinned by the "does not treat a non-exported provider of an imported module
  as resolvable" case.
- **T2:** biome's `noNonNullAssertion` rejected the component sort comparator
  (`a[0]!`); replaced with a total function returning -1 for empty arrays.
  Component arrays are never empty by construction.
- **T1 (lint):** biome's `noShadow` rejects a variable named `constructor`;
  renamed to `ctor` in `readInjections`.
- **T5:** `missing-forward-ref/valid` carries more shapes than the spec sketch
  named — the forwardRef-decorated pair (the actual AC-9 negative) plus an
  acyclic chain and a request-scoped/singleton pairing. Superset, no behavior
  change.
- **T7:** the non-nest gate case cannot reuse the same Nest sources: files
  importing `@nestjs/common` detect `nest` via code markers alone (spec 004),
  so the gate would honestly pass. The test stages an express app with local
  decorators instead. Recorded here so the next agent does not "simplify" it
  back into a tautology.
- **Registry counts** moved with each rule task (16 → 17 → 18 → 19 → 20) so
  every green commit was green; `blocking.test.ts` now asserts the full
  20-rule registry.
