# Tasks 011 — Rules: errors & lifecycle

TDD order: RED→GREEN clusters ordered by dependency; close-out last. Every
task commits only in a green state (`pnpm test`, `pnpm exec tsc --noEmit`,
`pnpm lint` green; `pnpm format` applied first).

- [x] **T1. `no-empty-catch` (AC-1, AC-5, AC-9).** RED:
  `tests/unit/rules/errors-lifecycle.test.ts` — flat half (`scanFixture`):
  invalid fixtures `bare.ts` (`catch {}`), `outside-comment.ts` (empty catch,
  trailing comment after the braces) with exact diagnostics; valid
  (`handled.ts`, `rethrow.ts`, `comment-only.ts`) → `[]`; fixture+doc
  existence; registry count 27. GREEN: fixtures, the rule
  (`src/rules/errors/no-empty-catch.ts`), doc, registration.
- [x] **T2. `no-error-details-leak` (AC-2, AC-5, AC-9).** RED: flat half —
  invalid `express-style.ts`, `nest-filter.ts` (the latter carries two stack
  references in one call → exactly one diagnostic) with exact diagnostics;
  valid `message-only.ts`, `logger-stack.ts`, `stack-free.ts` → `[]`;
  existence; registry count 28. GREEN: fixtures, the rule, doc, registration.
- [x] **T3. `missing-on-module-destroy` (AC-3, AC-5, AC-9).** RED:
  `scanNestFixture` half — `lifecycle-hooks/invalid` (`timer.service.ts` with
  `onModuleInit` only, `boot.service.ts` with `onApplicationBootstrap` only)
  exact diagnostics at class positions; `valid` (`init-and-destroy`,
  `before-shutdown-only`, controller with `onModuleInit`, hookless provider)
  → `[]`; existence; registry count 29. GREEN: fixtures, the rule, doc,
  registration.
- [x] **T4. `no-heavy-constructor-work` (AC-4, AC-5, AC-9).** RED:
  `scanNestFixture` half — `heavy-constructor/invalid` (`spawn-sync.service`
  with `execSync`, `redis.service` with `this.client.$connect()`,
  `dial.service` with a bare `connect()`) exact diagnostics; `valid` (same
  calls inside `onModuleInit`, own `connect` method via `this.connect()`,
  calls in a non-constructor method, controller constructor with the same
  calls) → `[]`; existence; registry count 30. GREEN: fixtures, the rule, doc,
  registration.
- [x] **T5. Integration through `runScan` (AC-6).** RED: extend
  `tests/integration/scan.test.ts` — staged Nest tree (package.json declares
  `@nestjs/common`) with one violation per rule yields all four diagnostics in
  report order; the same tree without the `@nestjs` dependency keeps
  `no-empty-catch`/`no-error-details-leak` and produces none of the two
  lifecycle rules. GREEN: fix whatever the full pipeline exposes (model
  wiring, gates) — no rule rewrites unless the pipeline contradicts the spec
  (then stop and report, per AGENTS.md).
- [x] **T6. e2e through the built bin (AC-7, AC-8).** RED:
  `tests/e2e/errors-lifecycle-rules.test.ts` — staged tree; JSON diagnostics
  for the leak + empty-catch + lifecycle findings; two runs byte-identical
  (AC-7); config file turning `no-empty-catch` off → silent, and to `error`
  → exit code 1 (AC-8); jsonl output stays diagnostics-only; stdout purity
  via `expectSuccess`. GREEN: stabilize the staged tree.
- [x] **T7. Close-out (no TDD).** Check off tasks; record deviations;
  `docs/RESEARCH.md` additions for any new ts-morph facts; spec status →
  Implemented; `docs/PLAN.md` F011 → Done. Full verification + live CLI
  smoke test.

## Deviations & notes

- **T1 — `CatchClause.getBody()` does not exist (ts-morph v28).** The first
  green run crashed with `clause.getBody is not a function`; the accessor is
  `getBlock()` (a catch clause's block is `block` in the compiler AST, not a
  function `body`). Same prototype-chain family as the
  `while.getCondition()`/`getTemplateSpans()` traps; probed the prototype and
  recorded in `docs/RESEARCH.md`. No parser/types re-exports were needed —
  `asKind` infers everything; the design anticipated this ("only if the
  implementation needs to name a type").
- **T2 — receiver chains land on the member access, not the root.** The
  first green run reported nothing: `res.status(500).json(…)` unwraps to the
  CallExpression `res.status(500)`, then to the PropertyAccessExpression
  `res.status`, and only then to the `res` identifier. The chain walker now
  unwraps member accesses too. Probe + RESEARCH entry.
- **T4 — `void`-wrapped calls position at the callee.** `void
  this.client.$connect()` starts at `this` (column 8), not at `void` — the
  spec 005 statement-level precedent, now pinned in fixture coordinates.
- **T5 — staged-tree line arithmetic.** The first run failed on the two
  `src/app.ts` lines (the multi-line `report()` signature was miscounted:
  catch is at line 9, the response call at line 10). Test-only fix; the
  lifecycle-rule positions matched on the first run.
- **T5/T6 — red-state honesty.** The pipeline wiring under test (model
  building, pack gate, severity overrides) pre-existed from F008–F010, so
  T5's gate behavior and all of T6 pass as regression gates rather than
  driving new implementation; T5's genuine red was the fixture arithmetic
  above. No rule code changed in T5/T6.
- Registry count moved 26 → 27 → 28 → 29 → 30 across T1–T4
  (`tests/unit/rules/blocking.test.ts`), keeping every commit internally
  consistent.
