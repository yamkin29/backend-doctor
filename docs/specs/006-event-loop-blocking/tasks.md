# Tasks 006 — Event-loop blocking rules (F006)

TDD order: shared collector before its consumers (things tests import come
first); contract tests after all rules exist. Every task red → green →
refactor; only green states are committed. Verification before every commit:
`pnpm test`, `pnpm exec tsc --noEmit`, `pnpm format`, `pnpm lint`.

- [x] **T1. `no-sync-fs-in-request-path` (AC-1..3).** RED: fixtures
  `tests/fixtures/backend-doctor/no-sync-fs-in-request-path/{invalid,valid}/`
  (design §3) + `tests/unit/rules/blocking.test.ts` describe with exact
  diagnostics for the three invalid files and `[]` for the five valid files
  (fails: rule does not exist). GREEN: `src/rules/blocking/sync-module-calls.ts`
  (import gate, shadow set, `this`-member guard, callee-name matching),
  `src/rules/blocking/sync-fs.ts`, entry in `productRules`. Commit:
  `feat(rules): no-sync-fs-in-request-path`.
- [x] **T2. `no-sync-crypto` (AC-4..6).** RED: crypto fixtures + test describe
  (fails). GREEN: `src/rules/blocking/sync-crypto.ts` over the shared
  collector with the `randomBytes`/`randomFill` no-callback predicate, entry
  in `productRules`. Commit: `feat(rules): no-sync-crypto`.
- [x] **T3. `no-cpu-bound-loop` (AC-7..9).** RED: loop fixtures + test
  describe + registry assertion (ten product ids, unique — fails until the
  third rule registers). GREEN: `src/rules/blocking/cpu-bound-loop.ts`
  (literal-bound condition check, await-yield ancestor walk), entry in
  `productRules`. Commit: `feat(rules): no-cpu-bound-loop`.
- [x] **T4. Integration contract (AC-10, engine level).** Extend
  `tests/integration/scan.test.ts`: temp project with fs, crypto and loop
  violations → three diagnostics in report order at `warn`; escalation of
  `no-sync-fs-in-request-path` to `error` flips only that diagnostic.
  Characterization task (rules exist; expected green — a failure is a bug,
  not a design gap). Commit: `test(integration): blocking rules contract`.
- [x] **T5. e2e contract (AC-10/11, through the bin).** New
  `tests/e2e/blocking-rules.test.ts` (temp tree via `runCli`/`makeTmpDir`):
  json scan exit 0 with the three warn diagnostics; config escalation →
  exit 1; `off` → `[]`; two consecutive scans byte-identical.
  Characterization task. Commit: `test(e2e): blocking rules contract through
  the bin`.
- [x] **T6. Rule docs (constitution §3).** One markdown per rule under
  `docs/rules/backend-doctor/`: Problem, Bad/Good examples, Scope notes
  (every recall hole from design §2), Configuration snippet. Commit:
  `docs(rules): blocking rule pack docs`.
- [x] **T7. Close-out.** Check off tasks, record deviations below, spec
  status → `Implemented`, `docs/PLAN.md` F006 → `Done`. Live CLI smoke test
  on a temp tree, output eyeballed. Commit:
  `docs(specs): 006-event-loop-blocking implemented — F006 done`.

## Deviations & notes

- **ts-morph v28 quirk: `while`/`do…while` conditions live on
  `getExpression()`.** `WhileStatement`/`DoStatement` are built on an
  `ExpressionedNode` base; `getCondition()` exists only on `ForStatement`
  and calling it on a while node is a runtime TypeError (their prototypes
  are effectively empty at runtime). Discovered in T3: the first
  implementation crashed inside the runner, which converted it into an
  `internal` diagnostic plus a `skippedChecks` entry (constitution §8
  observed live again), and the exact-diagnostic RED→GREEN test caught it.
  Fixed in `loops.ts` and documented in `docs/RESEARCH.md`.
- **`src/engine/parser/types.ts` was not changed.** The spec anticipated
  type re-exports (`ForStatement`, `WhileStatement`, `DoStatement`), but
  ts-morph's typed `asKind` overloads provided all the narrowing the rules
  needed — design decision 9 (grow the adapter on demonstrated need) means
  no change. The anticipated growth proved unnecessary.
- **T3 introduced `src/rules/blocking/loops.ts`** (loop/await sweep
  helpers) and a one-line `isFunctionLike` export in
  `src/rules/async/async-calls.ts`, so the function-like kind list is not
  duplicated between the packs.
- **Crypto fixture set grew `valid/top-level.ts`** beyond the spec's
  indicative list so AC-6's module-top-level clause has direct coverage.
- **T4/T5 ran as characterization** (tests written after the rules; both
  expected and were green on first run), as noted in the task list — no
  contract gaps surfaced.
- Live smoke (T7): three warns at exact positions on a temp app, clean
  `fs/promises` file untouched, exit 0, `schemaVersion: 1` — output
  eyeballed.
