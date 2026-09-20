# Tasks 012 — Rules: Prisma

TDD order: RED→GREEN clusters ordered by dependency; close-out last. Every
task commits only in a green state (`pnpm test`, `pnpm exec tsc --noEmit`,
`pnpm lint` green; `pnpm format` applied first).

- [x] **T1. `no-prisma-n-plus-one` (AC-1, AC-5, AC-9).** RED:
  `tests/unit/rules/prisma.test.ts` (`scanFixture` with
  `detectedFrameworks: ["prisma"]`) — invalid fixtures `for-of-await.ts`,
  `for-await.ts`, `while-await.ts` with exact diagnostics; valid
  `batched-in.ts`, `promise-all-map.ts`, `await-before-loop.ts`,
  `floating-in-loop.ts`, `own-find-many.ts` → `[]`; fixture+doc existence;
  registry count 31. GREEN: fixtures, the rule
  (`src/rules/prisma/no-prisma-n-plus-one.ts` + shared
  `src/rules/prisma/prisma-calls.ts`), doc, registration.
- [x] **T2. `no-unsafe-raw-query` (AC-2, AC-5, AC-9).** RED: same unit
  file — invalid `template-unsafe.ts`, `concat-unsafe.ts`,
  `plain-call-dynamic.ts` with exact diagnostics; valid `tagged-template.ts`,
  `literal-unsafe.ts`, `prisma-sql.ts`, `no-span-template.ts` → `[]`;
  existence; registry count 32. GREEN: fixtures, the rule, doc,
  registration.
- [x] **T3. `find-many-without-pagination` (AC-3, AC-5, AC-9).** RED: same
  unit file — invalid `no-args.ts`, `no-take.ts` with exact diagnostics;
  valid `with-take.ts`, `take-shorthand.ts`, `spread-args.ts`,
  `find-first.ts` → `[]`; existence; registry count 33. GREEN: fixtures, the
  rule, doc, registration.
- [x] **T4. `no-long-running-transaction` (AC-4, AC-5, AC-9).** RED: same
  unit file — invalid `fetch-inside.ts`, `timer-inside.ts`,
  `axios-inside.ts` with exact diagnostics; valid `db-only.ts`,
  `external-before.ts`, `array-form.ts` → `[]`; existence; registry count
  34. GREEN: fixtures, the rule, doc, registration.
- [x] **T5. Integration through `runScan` (AC-6).** RED: extend
  `tests/integration/scan.test.ts` — staged tree whose `package.json`
  declares `@prisma/client` with one violation per rule yields the pack
  diagnostics in report order with `"prisma"` in `projects[0].frameworks`;
  the same sources without the dependency produce none of the four.
  GREEN: fix whatever the full pipeline exposes (gates) — no rule rewrites
  unless the pipeline contradicts the spec (then stop and report, per
  AGENTS.md).
- [x] **T6. e2e through the built bin (AC-6, AC-7, AC-8).** RED:
  `tests/e2e/prisma-rules.test.ts` — staged tree with `@prisma/client`;
  JSON diagnostics for one violation per rule; two runs byte-identical
  (AC-7); config turning `no-unsafe-raw-query` off → silent and to `error`
  → exit code 1 (AC-8); the whole pack off → empty report; jsonl output
  stays diagnostics-only; a dependency-free tree yields zero findings;
  stdout purity via `expectSuccess`. GREEN: stabilize the staged tree.
- [x] **T7. Close-out (no TDD).** Check off tasks; record deviations;
  `docs/RESEARCH.md` additions for any new ts-morph facts; spec status →
  Implemented; `docs/PLAN.md` F012 → Done. Full verification + live CLI
  smoke test.

## Deviations & notes

- **T1 — the documented `type Node` trap bit again.** `prisma-calls.ts`
  initially imported `Node` type-only, so the `Node.is*` guards crashed at
  runtime ("Node is not defined"), surfaced by the runner as `internal`
  diagnostics (constitution §8 working as designed). Already the #1 entry
  of the ts-morph RESEARCH section; no new knowledge, just evidence it
  keeps biting — kept the value import.
- **T2 — template-literal shape split.** A span-free template literal
  (`` `SELECT 1` ``) parses as `NoSubstitutionTemplateLiteral`, not
  `TemplateExpression` — the design anticipated the check; recorded in
  RESEARCH so the next rule does not misclassify static templates.
- **T2 — `getArguments()[0]` is `Node`-typed.** After the
  `Node.isSpreadElement` guard the element is still not an `Expression` for
  the type system; the established `argument as Expression` cast
  (`no-ssrf.ts`, `no-unsafe-merge.ts`) applies. `isPrismaSqlTag` needed the
  parser boundary's first type-only re-export growth
  (`TaggedTemplateExpression`), exactly as the design anticipated.
- **T2/T5 — biome `noTemplateCurlyInString`.** The raw-rule message
  originally embedded the literal `${value}` placeholder; the shipped
  message drops it ("prisma.$queryRaw`…`") to keep `pnpm lint` warning-free,
  and the T5 staged raw query uses string concatenation instead of a
  template interpolation for the same reason (which also widens coverage:
  concat into `$queryRawUnsafe`). Recorded here because the spec's message
  template shows the placeholder form.
- **T1–T4 — fixture line arithmetic.** First-run coordinates for T1/T2
  were off by my miscounting of fixture lines (columns were correct);
  pinned from the failing assertions per the spec 007 precedent. T4's
  coordinates were predicted exactly on the first run.
- **T5/T6 — red-state honesty.** The pipeline wiring under test (framework
  detection, pack gate, reporters, severity overrides) pre-existed from
  F003–F004, so both tasks' tests passed on their first run and are
  regression gates rather than implementation drivers; no rule code changed
  in T5/T6. T6's staged tree exercised the same violations as T5.
- Registry count moved 30 → 31 → 32 → 33 → 34 across T1–T4
  (`tests/unit/rules/blocking.test.ts`), keeping every commit internally
  consistent.
