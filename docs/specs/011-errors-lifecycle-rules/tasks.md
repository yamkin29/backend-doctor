# Tasks 011 — Rules: errors & lifecycle

TDD order: RED→GREEN clusters ordered by dependency; close-out last. Every
task commits only in a green state (`pnpm test`, `pnpm exec tsc --noEmit`,
`pnpm lint` green; `pnpm format` applied first).

- [ ] **T1. `no-empty-catch` (AC-1, AC-5, AC-9).** RED:
  `tests/unit/rules/errors-lifecycle.test.ts` — flat half (`scanFixture`):
  invalid fixtures `bare.ts` (`catch {}`), `outside-comment.ts` (empty catch,
  trailing comment after the braces) with exact diagnostics; valid
  (`handled.ts`, `rethrow.ts`, `comment-only.ts`) → `[]`; fixture+doc
  existence; registry count 27. GREEN: fixtures, the rule
  (`src/rules/errors/no-empty-catch.ts`), doc, registration.
- [ ] **T2. `no-error-details-leak` (AC-2, AC-5, AC-9).** RED: flat half —
  invalid `express-style.ts`, `nest-filter.ts` (the latter carries two stack
  references in one call → exactly one diagnostic) with exact diagnostics;
  valid `message-only.ts`, `logger-stack.ts`, `stack-free.ts` → `[]`;
  existence; registry count 28. GREEN: fixtures, the rule, doc, registration.
- [ ] **T3. `missing-on-module-destroy` (AC-3, AC-5, AC-9).** RED:
  `scanNestFixture` half — `lifecycle-hooks/invalid` (`timer.service.ts` with
  `onModuleInit` only, `boot.service.ts` with `onApplicationBootstrap` only)
  exact diagnostics at class positions; `valid` (`init-and-destroy`,
  `before-shutdown-only`, controller with `onModuleInit`, hookless provider)
  → `[]`; existence; registry count 29. GREEN: fixtures, the rule, doc,
  registration.
- [ ] **T4. `no-heavy-constructor-work` (AC-4, AC-5, AC-9).** RED:
  `scanNestFixture` half — `heavy-constructor/invalid` (`spawn-sync.service`
  with `execSync`, `redis.service` with `this.client.$connect()`,
  `dial.service` with a bare `connect()`) exact diagnostics; `valid` (same
  calls inside `onModuleInit`, own `connect` method via `this.connect()`,
  calls in a non-constructor method, controller constructor with the same
  calls) → `[]`; existence; registry count 30. GREEN: fixtures, the rule, doc,
  registration.
- [ ] **T5. Integration through `runScan` (AC-6).** RED: extend
  `tests/integration/scan.test.ts` — staged Nest tree (package.json declares
  `@nestjs/common`) with one violation per rule yields all four diagnostics in
  report order; the same tree without the `@nestjs` dependency keeps
  `no-empty-catch`/`no-error-details-leak` and produces none of the two
  lifecycle rules. GREEN: fix whatever the full pipeline exposes (model
  wiring, gates) — no rule rewrites unless the pipeline contradicts the spec
  (then stop and report, per AGENTS.md).
- [ ] **T6. e2e through the built bin (AC-7, AC-8).** RED:
  `tests/e2e/errors-lifecycle-rules.test.ts` — staged tree; JSON diagnostics
  for the leak + empty-catch + lifecycle findings; two runs byte-identical
  (AC-7); config file turning `no-empty-catch` off → silent, and to `error`
  → exit code 1 (AC-8); jsonl output stays diagnostics-only; stdout purity
  via `expectSuccess`. GREEN: stabilize the staged tree.
- [ ] **T7. Close-out (no TDD).** Check off tasks; record deviations;
  `docs/RESEARCH.md` additions for any new ts-morph facts; spec status →
  Implemented; `docs/PLAN.md` F011 → Done. Full verification + live CLI
  smoke test.

## Deviations & notes

- (filled during implementation)
