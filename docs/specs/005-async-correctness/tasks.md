# Tasks 005 — Async-correctness rules (F005)

TDD order: shared heuristic first (rules depend on it), then one red→green
cluster per rule (fixtures + unit tests written first), then cross-cutting
integration/e2e, docs, close-out. Every task is committed only in a green
state (`pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`; `pnpm format`
before committing).

- **T1. Shared async-call heuristic (AC-1..6, AC-11 foundations).**
  RED: `tests/unit/rules/async-calls.test.ts` — candidates for async function
  declarations, async arrow/function variables, `this.<asyncMethod>()`,
  `fetch`; scope-aware shadowing (inner sync wins, outer async still flagged);
  suppressions (await/void/assigned/returned/chained); constructor tagging.
  GREEN: `src/engine/parser/types.ts` re-exports (design §1);
  `src/rules/async/async-calls.ts`.
- **T2. `no-floating-promises` (AC-1..6).**
  RED: fixtures `no-floating-promises/{invalid,valid}/*` per spec;
  `tests/unit/rules/async.test.ts` describe-block with exact diagnostics.
  GREEN: `src/rules/async/no-floating-promises.ts`; registry entry in
  `src/rules/index.ts`.
- **T3. `no-async-constructor-work` (AC-11..12).**
  RED: fixtures + `async.test.ts` block. GREEN: rule module + registry.
- **T4. `no-async-foreach-callback` (AC-7..8).**
  RED: fixtures + `async.test.ts` block. GREEN: rule module + registry.
- **T5. `unhandled-json-parse` (AC-9..10).**
  RED: fixtures + `async.test.ts` block. GREEN: rule module + registry.
- **T6. `no-unhandled-emitter-error` (AC-13..15, AC-16).**
  RED: fixtures + `async.test.ts` block + registry assertion (five new ids,
  seven product rules). GREEN: rule module + registry.
- **T7. Pipeline and contracts (AC-17..18).**
  RED: `tests/integration/scan.test.ts` temp-project block (three diagnostics
  in report order, warn severity, escalation flips one to error);
  `tests/e2e/async-rules.test.ts` (json rule ids through the bin, exit-code
  escalation, byte-identity, off/ignore suppression).
  GREEN: expected green-on-arrival (pure test task over T1–T6); any red is a
  bug — fix forward and record under Deviations.
- **T8. Rule docs (constitution §3). No TDD — documentation.**
  `docs/rules/backend-doctor/{no-floating-promises,no-async-foreach-callback,unhandled-json-parse,no-async-constructor-work,no-unhandled-emitter-error}.md`
  in the `no-eval.md` format (problem, bad/good, scope notes, config).
- **T9. Close-out. No TDD — bookkeeping.**
  Check off tasks, record deviations, spec status → `Implemented`,
  `docs/PLAN.md` F005 → `Done`.

## Deviations & notes

_(recorded during implementation)_
