# Tasks 005 — Async-correctness rules (F005)

TDD order: shared heuristic first (rules depend on it), then one red→green
cluster per rule (fixtures + unit tests written first), then cross-cutting
integration/e2e, docs, close-out. Every task is committed only in a green
state (`pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`; `pnpm format`
before committing).

- [x] **T1. Shared async-call heuristic (AC-1..6, AC-11 foundations).**
  RED: `tests/unit/rules/async-calls.test.ts` — candidates for async function
  declarations, async arrow/function variables, `this.<asyncMethod>()`,
  `fetch`; scope-aware shadowing (inner sync wins, outer async still flagged);
  suppressions (await/void/assigned/returned/chained); constructor tagging.
  GREEN: `src/rules/async/async-calls.ts`. (`parser/types.ts` needed no
  re-export growth — see Deviations.)
- [x] **T2. `no-floating-promises` (AC-1..6).**
  RED: fixtures `no-floating-promises/{invalid,valid}/*` per spec;
  `tests/unit/rules/async.test.ts` describe-block with exact diagnostics.
  GREEN: `src/rules/async/no-floating-promises.ts`; registry entry in
  `src/rules/index.ts`.
- [x] **T3. `no-async-constructor-work` (AC-11..12).**
  RED: fixtures + `async.test.ts` block. GREEN: rule module + registry.
- [x] **T4. `no-async-foreach-callback` (AC-7..8).**
  RED: fixtures + `async.test.ts` block. GREEN: rule module + registry.
- [x] **T5. `unhandled-json-parse` (AC-9..10).**
  RED: fixtures + `async.test.ts` block. GREEN: rule module + registry.
- [x] **T6. `no-unhandled-emitter-error` (AC-13..15, AC-16).**
  RED: fixtures + `async.test.ts` block + registry assertion (five new ids,
  seven product rules). GREEN: rule module + registry.
- [x] **T7. Pipeline and contracts (AC-17..18).**
  RED: `tests/integration/scan.test.ts` temp-project block (three diagnostics
  in report order, warn severity, escalation flips one to error);
  `tests/e2e/async-rules.test.ts` (json rule ids through the bin, exit-code
  escalation, byte-identity, off/ignore suppression). Green-on-arrival as
  anticipated — characterization pins over T1–T6 (recorded below).
- [x] **T8. Rule docs (constitution §3). No TDD — documentation.**
  `docs/rules/backend-doctor/{no-floating-promises,no-async-foreach-callback,unhandled-json-parse,no-async-constructor-work,no-unhandled-emitter-error}.md`
  in the `no-eval.md` format (problem, bad/good, scope notes, config).
- [x] **T9. Close-out. No TDD — bookkeeping.**
  Checked off tasks, recorded deviations, spec status → `Implemented`,
  `docs/PLAN.md` F005 → `Done`.

## Deviations & notes

- **T5 registry wiring slipped into T6.** `unhandled-json-parse` was
  implemented in T5 but its `productRules` entry only landed with T6; the
  AC-16 registry assertion (written red in T6) caught it. Lesson: registry
  wiring belongs in the same green commit as the rule.
- **`Node.isParameter` does not exist in ts-morph 28.** First run of the
  emitter rule crashed inside `create` — and the runner converted the crash
  into an `internal` diagnostic plus a `skippedChecks` entry exactly as
  constitution §8 prescribes (live verification of fail-soft). Fixed with
  `node.asKind(SyntaxKind.Parameter)`, which also gives the type narrowing
  the missing guard would have provided. Recorded in RESEARCH.md.
- **`parser/types.ts` needed no re-export growth.** Design anticipated
  growing the vocabulary, but the established surface (`Node` type guards,
  `node.asKind`, `SyntaxKind`) already covered everything; only two helper
  exports were added to `async-calls.ts` (`isInsideFunctionLike`,
  `nearestFunctionLike`). Constitution §4 held without churn.
- **Two test-expectation bugs (T1/T4), no rule bugs.** The constructor-
  nesting helper test expected a candidate for a *sync* `helper()` call, and
  the forEach fixture line was miscounted (4 vs 5). Both were errors in the
  red tests themselves; fixed by correcting the expectations.
- **T7 was green-on-arrival** as the task anticipated: integration + e2e are
  characterization pins over T1–T6 behavior, not red→green tasks.
- **ts-morph gotchas moved to RESEARCH.md** (traversal control via callback
  return value, missing `Node.isParameter`, `getCatchClause()` semantics,
  structural `void`/`await` suppression).
