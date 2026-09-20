# Tasks 013 — Graph rules: cycles & unused

TDD order: RED→GREEN clusters ordered by dependency; close-out last. Every
task commits only in a green state (`pnpm test`, `pnpm exec tsc --noEmit`,
`pnpm lint` green; `pnpm format` applied first).

- [ ] **T1. Import-graph machinery (AC-1, AC-2, AC-8).** RED:
  `tests/unit/engine/imports.test.ts` — specifier resolution (literal,
  `.js`→`.ts`, `.mjs`/`.cjs` mappings, `/index` variants, bare ignored,
  unresolvable → none, self-edge dropped), cycle components (3-ring, two
  disjoint rings, acyclic) with canonical chains, entry detection
  (`main`, `bin` string/object, conventional files), reachability,
  degenerate inputs. GREEN: `src/engine/imports.ts`.
- [ ] **T2. Project-rule kind (AC-5, AC-6).** RED:
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
- [ ] **T3. `circular-dependency` (AC-1, AC-9).** RED:
  `tests/fixtures/graph/circular-dependency/{valid,invalid}` trees +
  `tests/unit/rules/graph.test.ts` describe with exact diagnostics;
  registry count 35. GREEN: fixtures, the rule (`src/rules/graph/
  circular-dependency.ts`), doc, registration in
  `productProjectRules`.
- [ ] **T4. `unused-file` (AC-2, AC-9).** RED: fixture trees + unit
  describe with exact diagnostics (orphan flagged; entry-less tree
  silent); registry count 36. GREEN: fixtures, the rule, doc,
  registration.
- [ ] **T5. `unused-export` (AC-3, AC-9).** RED: fixture trees + unit
  describe with exact diagnostics (unused function/class flagged;
  named/default/namespace/side-effect/barrel usage and entry exemption
  silent); registry count 37. GREEN: fixtures, the rule, doc,
  registration.
- [ ] **T6. `unused-dependency` (AC-4, AC-9).** RED: fixture trees +
  unit describe with exact diagnostics (unused dependency flagged;
  devDependencies/`@types/*`/`workspace:`/scripts-mention silent);
  registry count 38. GREEN: fixtures, the rule, doc, registration.
- [ ] **T7. Pipeline wiring through `runScan` (AC-6).** RED: extend
  `tests/integration/scan.test.ts` — a staged tree with a cycle, an
  orphan file, an unused export and an unused dependency yields all four
  pack rules through the full pipeline in report order; a clean tree
  yields none. GREEN: wire the project-rule pass into `src/core/scan.ts`
  after the per-file loop — no rule rewrites unless the pipeline
  contradicts the spec (then stop and report, per AGENTS.md).
- [ ] **T8. e2e through the built bin (AC-6, AC-7, AC-8).** RED:
  `tests/e2e/graph-rules.test.ts` — staged tree; JSON diagnostics for the
  four violations; two runs byte-identical (AC-7); config turning a pack
  rule `off` → silent and to `error` → exit 1 (AC-6); jsonl stays
  diagnostics-only; a single-file scan target does not crash (AC-8);
  stdout purity via `expectSuccess`. GREEN: stabilize the staged tree.
- [ ] **T9. Close-out (no TDD).** Check off tasks; record deviations;
  `docs/RESEARCH.md` additions for any new ts-morph/ESM facts; spec
  status → Implemented; `docs/PLAN.md` F013 → Done. Full verification +
  live CLI smoke test.

## Deviations & notes

- (none yet)
