# Tasks 013 — Graph rules: cycles & unused

TDD order: RED→GREEN clusters ordered by dependency; close-out last. Every
task commits only in a green state (`pnpm test`, `pnpm exec tsc --noEmit`,
`pnpm lint` green; `pnpm format` applied first).

- [x] **T1. Import-graph machinery (AC-1, AC-2, AC-8).** RED:
  `tests/unit/engine/imports.test.ts` — specifier resolution (literal,
  `.js`→`.ts`, `.mjs`/`.cjs` mappings, `/index` variants, bare ignored,
  unresolvable → none, self-edge dropped), cycle components (3-ring, two
  disjoint rings, acyclic) with canonical chains, entry detection
  (`main`, `bin` string/object, conventional files), reachability,
  degenerate inputs. GREEN: `src/engine/imports.ts`.
- [x] **T2. Project-rule kind (AC-5, AC-6).** RED:
  `tests/unit/engine/project-rules.test.ts` — `registerProjectRule`/
  `allProjectRules`; `runProjectRules` gate matrix (pack gate,
  `ignore.rules`, severity `off`/`error`), fail-soft isolation (throwing
  `analyze` → one `internal` diagnostic + skippedChecks, siblings keep
  reporting), finding stamping (id/filePath/line/column/message), package
  surface reading (dependencies keys + scripts, missing/invalid
  package.json → skippedChecks). GREEN: registry additions, the
  `ProjectRuleDefinition`/context/`runProjectRules` pass,
  `readPackageJsonSurface`. Registry count stays 34 (no product rules
  yet).
- [x] **T3. `circular-dependency` (AC-1, AC-9).** RED:
  `tests/fixtures/graph/circular-dependency/{valid,invalid}` trees +
  `tests/unit/rules/graph.test.ts` describe with exact diagnostics;
  registry count 35. GREEN: fixtures, the rule (`src/rules/graph/
  circular-dependency.ts`), doc, registration in
  `productProjectRules`.
- [x] **T4. `unused-file` (AC-2, AC-9).** RED: fixture trees + unit
  describe with exact diagnostics (orphan flagged; entry-less tree
  silent); registry count 36. GREEN: fixtures, the rule, doc,
  registration.
- [x] **T5. `unused-export` (AC-3, AC-9).** RED: fixture trees + unit
  describe with exact diagnostics (unused function/class flagged;
  named/default/namespace/side-effect/barrel usage and entry exemption
  silent); registry count 37. GREEN: fixtures, the rule, doc,
  registration.
- [x] **T6. `unused-dependency` (AC-4, AC-9).** RED: fixture trees +
  unit describe with exact diagnostics (unused dependency flagged;
  devDependencies/`@types/*`/`workspace:`/scripts-mention silent);
  registry count 38. GREEN: fixtures, the rule, doc, registration.
- [x] **T7. Pipeline wiring through `runScan` (AC-6).** RED: extend
  `tests/integration/scan.test.ts` — a staged tree with a cycle, an
  orphan file, an unused export and an unused dependency yields all four
  pack rules through the full pipeline in report order; a clean tree
  yields none. GREEN: wire the project-rule pass into `src/core/scan.ts`
  after the per-file loop — no rule rewrites unless the pipeline
  contradicts the spec (then stop and report, per AGENTS.md).
- [x] **T8. e2e through the built bin (AC-6, AC-7, AC-8).** RED:
  `tests/e2e/graph-rules.test.ts` — staged tree; JSON diagnostics for the
  four violations; two runs byte-identical (AC-7); config turning a pack
  rule `off` → silent and to `error` → exit 1 (AC-6); jsonl stays
  diagnostics-only; a single-file scan target does not crash (AC-8);
  stdout purity via `expectSuccess`. GREEN: stabilize the staged tree.
- [x] **T9. Close-out (no TDD).** Check off tasks; record deviations;
  `docs/RESEARCH.md` additions for any new ts-morph/ESM facts; spec
  status → Implemented; `docs/PLAN.md` F013 → Done. Full verification +
  live CLI smoke test.

## Deviations & notes

- **T1 — leftover helper name.** The SCC sort referenced a `compare`
  helper that did not exist; the failing unit test caught it and the
  comparator was inlined (the `collectFiles` precedent).
- **T1 — fixture specifier arithmetic.** The reachability fixture imported
  `"./shared/util"` from `users/service.ts`, which resolves one level
  below the intended file; the specifier became `"../shared/util"`.
  Test-only fix.
- **T2 — type-only import cycle by design.** `registry.ts` names
  `ProjectRuleContext` (type-only) while `project-rules.ts` names
  `ProjectRuleDefinition` (type-only); both imports erase at compile time,
  so there is no runtime cycle — same shape as `parser/types.ts` naming the
  Nest model.
- **T3 — context grew `relativePath`.** Cycle messages carry
  target-relative chains, and only the pass knows the scan root; the
  context exposes one sanctioned converter instead of raw roots. Additive;
  T2 tests unchanged.
- **T5 — phantom accessors on specifiers (ts-morph v28).**
  `getPropertyNameNode()` does not exist on `ImportSpecifier`/
  `ExportSpecifier`; `getName()` returns the *source* name (`a as b` →
  `"a"`), which is exactly what usage detection needs, and the exported
  alias of a local `export { a as b }` has no accessor at all — it is
  derived from the specifier text. RESEARCH entry added.
- **T5 — AC-3 clarification (recorded in the spec Resolution).**
  `unused-export` also stays silent when the project has no entry files:
  without a known public-surface boundary every import-less export would
  be flagged, which is the precision gate AC-2 already establishes. All
  AC-3 cases with entries present behave exactly as specified.
- **T6 — dependencies surface carries specifiers.** Protocols
  (`workspace:`) live in dependency *values*, so `readPackageJsonSurface`
  returns name→spec pairs and the context exposes `packageRoot`; the T2
  surface test was updated to the record shape as part of the task's
  refactor step.
- **T7 — true graph findings in every full-scan fixture.** Wiring the pack
  changed the combined output of existing staged trees; all new findings
  were verified as true positives before updating expectations: bad-app's
  `util.ts` is unreachable with a dead export; the DI fixture's x/y pair
  is an import cycle as well as a DI cycle; the layers-dto staged DTO file
  is imported by nobody; staged trees that declared dependencies without
  importing them (prisma pack, framework express/lodash, the DI/layers
  non-nest express stubs) gained `unused-dependency` findings. The prisma
  trees got a trailing type-only `@prisma/client` import (positions
  unchanged) so "one violation per pack rule" keeps its original intent.
- **T7 — config rule-id validation learns project rules.**
  `REGISTERED_RULE_IDS` in the scan command now unions
  `allProjectRules()`; without it a config naming a graph rule dies with
  "unknown rule id (is it registered?)". A new-rule-kind wiring fact —
  recorded in RESEARCH.
- Registry count moved 34 → 35 → 36 → 37 → 38 across T3–T6
  (`tests/unit/rules/blocking.test.ts`, file + project product rules).
