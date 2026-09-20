# Tasks 012 — Rules: Prisma

TDD order: RED→GREEN clusters ordered by dependency; close-out last. Every
task commits only in a green state (`pnpm test`, `pnpm exec tsc --noEmit`,
`pnpm lint` green; `pnpm format` applied first).

- [ ] **T1. `no-prisma-n-plus-one` (AC-1, AC-5, AC-9).** RED:
  `tests/unit/rules/prisma.test.ts` (`scanFixture` with
  `detectedFrameworks: ["prisma"]`) — invalid fixtures `for-of-await.ts`,
  `for-await.ts`, `while-await.ts` with exact diagnostics; valid
  `batched-in.ts`, `promise-all-map.ts`, `await-before-loop.ts`,
  `floating-in-loop.ts`, `own-find-many.ts` → `[]`; fixture+doc existence;
  registry count 31. GREEN: fixtures, the rule
  (`src/rules/prisma/no-prisma-n-plus-one.ts` + shared
  `src/rules/prisma/prisma-calls.ts`), doc, registration.
- [ ] **T2. `no-unsafe-raw-query` (AC-2, AC-5, AC-9).** RED: same unit
  file — invalid `template-unsafe.ts`, `concat-unsafe.ts`,
  `plain-call-dynamic.ts` with exact diagnostics; valid `tagged-template.ts`,
  `literal-unsafe.ts`, `prisma-sql.ts`, `no-span-template.ts` → `[]`;
  existence; registry count 32. GREEN: fixtures, the rule, doc,
  registration.
- [ ] **T3. `find-many-without-pagination` (AC-3, AC-5, AC-9).** RED: same
  unit file — invalid `no-args.ts`, `no-take.ts` with exact diagnostics;
  valid `with-take.ts`, `take-shorthand.ts`, `spread-args.ts`,
  `find-first.ts` → `[]`; existence; registry count 33. GREEN: fixtures, the
  rule, doc, registration.
- [ ] **T4. `no-long-running-transaction` (AC-4, AC-5, AC-9).** RED: same
  unit file — invalid `fetch-inside.ts`, `timer-inside.ts`,
  `axios-inside.ts` with exact diagnostics; valid `db-only.ts`,
  `external-before.ts`, `array-form.ts` → `[]`; existence; registry count
  34. GREEN: fixtures, the rule, doc, registration.
- [ ] **T5. Integration through `runScan` (AC-6).** RED: extend
  `tests/integration/scan.test.ts` — staged tree whose `package.json`
  declares `@prisma/client` with one violation per rule yields the pack
  diagnostics in report order with `"prisma"` in `projects[0].frameworks`;
  the same sources without the dependency produce none of the four.
  GREEN: fix whatever the full pipeline exposes (gates) — no rule rewrites
  unless the pipeline contradicts the spec (then stop and report, per
  AGENTS.md).
- [ ] **T6. e2e through the built bin (AC-6, AC-7, AC-8).** RED:
  `tests/e2e/prisma-rules.test.ts` — staged tree with `@prisma/client`;
  JSON diagnostics for one violation per rule; two runs byte-identical
  (AC-7); config turning `no-unsafe-raw-query` off → silent and to `error`
  → exit code 1 (AC-8); the whole pack off → empty report; jsonl output
  stays diagnostics-only; a dependency-free tree yields zero findings;
  stdout purity via `expectSuccess`. GREEN: stabilize the staged tree.
- [ ] **T7. Close-out (no TDD).** Check off tasks; record deviations;
  `docs/RESEARCH.md` additions for any new ts-morph facts; spec status →
  Implemented; `docs/PLAN.md` F012 → Done. Full verification + live CLI
  smoke test.

## Deviations & notes

- (none yet)
