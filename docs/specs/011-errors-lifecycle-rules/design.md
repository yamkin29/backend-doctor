# Design 011 — Rules: errors & lifecycle

## Module layout

- `src/rules/errors/no-empty-catch.ts` — new pack dir `errors/` for the
  framework-free error rules; the rule and its `.stack`-free detection logic.
- `src/rules/errors/no-error-details-leak.ts` — response-root recognition +
  `.stack` argument search; all helpers private to the file (single consumer).
- `src/rules/nest/missing-on-module-destroy.ts` — model providers × in-file
  AST method census (the `no-business-logic-in-controller` shape).
- `src/rules/nest/no-heavy-constructor-work.ts` — `findModuleApiCalls`
  candidates narrowed to provider constructors via `nearestFunctionLike`.
- `src/rules/index.ts` — four registrations in `productRules`.
- `src/engine/parser/types.ts` — type-only re-exports only if the
  implementation needs to *name* a type (expected: none; `asKind` infers).
  No runtime adapter changes.
- `tests/fixtures/backend-doctor/{no-empty-catch,no-error-details-leak}/` —
  flat fixtures (spec 007 convention).
- `tests/fixtures/nest/errors-lifecycle/{lifecycle-hooks,heavy-constructor}/`
  — multi-file mini-apps (spec 009/010 convention).
- `tests/unit/rules/errors-lifecycle.test.ts` — both halves: `scanFixture`
  (flat, from `security.test.ts`) and `scanNestFixture` (model, from
  `layers-dto.test.ts`).
- `tests/unit/rules/blocking.test.ts` — registry count 26 → 30 (incremental
  per task: 27, 28, 29, 30).
- `tests/integration/scan.test.ts` — new `runScan` describe (AC-6).
- `tests/e2e/errors-lifecycle-rules.test.ts` — bin-level tests (AC-7, AC-8).
- `docs/rules/backend-doctor/{no-empty-catch,no-error-details-leak,
  missing-on-module-destroy,no-heavy-constructor-work}.md` — four rule docs.

## Key decisions

1. **No model extension.** Lifecycle and constructor facts are read from the
   file AST inside the rules; the model contributes provider identity and
   class positions. Alternative — `lifecycleHooks: string[]` on
   `NestProviderEntry` — rejected: one consumer, and the in-rule AST read is
   already precedented (`no-business-logic-in-controller`); the model grows
   only when a *second* consumer needs the same data.
2. **Pack placement.** `errors/` is a new rules directory for the two
   framework-free rules; the two nest-gated rules live in `nest/` beside the
   F009/F010 packs. Alternative — one `errors-lifecycle/` directory for all
   four — rejected: `nest/` is the established home for gated rules and the
   registry/test/docs structure already splits along that line.
3. **Empty-catch comment detection:** `statements.length === 0` plus full-text
   check `getFullText().replace(/[{}\s]/g, "") === ""`. Comments inside an
   empty block are trivia, not nodes, so range APIs would need
   prototype-chain probing; text stripping is deterministic and trivially
   testable. `getFullText()` ends at the closing brace, so a trailing comment
   *outside* the braces does not silence the rule (documented in the rule
   doc: the comment goes inside).
4. **Response-root recognition mirrors `REQUEST_ROOTS`:** unwrap the receiver
   chain (`CallExpression` → its expression, `ParenthesizedExpression` → its
   expression) until an `Identifier`; the root must be `res` or `response`.
   Alternative — handler parameter-position analysis (`(err, req, res)`) —
   rejected: needs binding tracking the syntax-only engine does not have;
   the root-name heuristic is the spec 007 precedent. `res.json(err)`
   (whole object) is not flagged — resolution 1.
5. **`.stack` argument search:** per call, scan every argument's descendant
   subtree for a `PropertyAccessExpression` named `stack`; one diagnostic per
   call regardless of hit count (a response either leaks or it does not —
   two findings for `{ stack: e.stack, trace: e.stack }` would be noise).
6. **Constructor containment without new guards:** walk ancestors with the
   exported `nearestFunctionLike`, then require
   `getKind() === SyntaxKind.Constructor` (kind checks, not
   `Node.isConstructorDeclaration` — same prototype-chain trap family as the
   missing `Node.isParameter`, RESEARCH). The constructor's parent must be a
   `ClassDeclaration` whose name is a model provider of the scanned file.
7. **No double-fire, by construction (resolution 3).** F006's sync
   fs/crypto rules flag inside every function body (constructors included),
   and F005's `no-async-constructor-work` owns same-file async calls + bare
   `fetch` + own async members. This pack's vocabulary
   (`child_process` module calls, `connect`/`$connect` member calls) is
   disjoint from both; `this.connect()` on a class declaring `connect` is
   excluded by `findModuleApiCalls`' own-class-member protection, which is
   exactly where F005 *would* have fired — the two rules partition, not
   overlap.
8. **Registry order and incremental counts.** The four rules register after
   the security pack (errors) and after the layers-dto pack (nest), keeping
   the array grouped by pack; the count assertion steps 27 → 30 with each
   green task so every commit is internally consistent.
9. **Determinism.** All findings derive from one `forEachDescendant` pass per
   rule over the file (source order) or from the sorted model; messages are
   template strings over names/counts already in the AST/model. No clocks,
   no maps iteration-order hazards (all `Set`/`Map` keys are file-local
   names inserted in source order and only membership-tested).

## Dependencies

None (resolution 4). `findModuleApiCalls` and `nearestFunctionLike` are
internal imports; no package.json change.

## Test map (AC → test)

| AC | Test |
|---|---|
| AC-1 | `tests/unit/rules/errors-lifecycle.test.ts` — `no-empty-catch` invalid fixtures (`bare.ts`: `catch {}`; `outside-comment.ts`: comment after the braces) exact diagnostics; valid fixtures (`handled.ts`, `rethrow.ts`, `comment-only.ts`) → `[]`; fixture+doc existence |
| AC-2 | same file — `no-error-details-leak` invalid (`express-style.ts`, `nest-filter.ts`) exact diagnostics incl. one-diagnostic-per-call; valid (`message-only.ts`, `logger-stack.ts`, `stack-free.ts`) → `[]`; existence |
| AC-3 | same file, `scanNestFixture` — `lifecycle-hooks/invalid` (init without shutdown: `onModuleInit` case, `onApplicationBootstrap` case) exact diagnostics at class positions; `valid` (init+destroy, before-shutdown-only, controller with hook, hookless provider) → `[]`; existence |
| AC-4 | same file, `scanNestFixture` — `heavy-constructor/invalid` (`execSync`, `this.client.$connect()`, bare `connect()`) exact diagnostics; `valid` (same calls in `onModuleInit`, own `connect` method, non-constructor method, controller constructor) → `[]`; existence |
| AC-5 | the four `valid` fixtures assert `[]` (covered by AC-1..4 rows) |
| AC-6 | `tests/integration/scan.test.ts` — staged Nest tree (package.json with `@nestjs/common`) yields the pack diagnostics via `runScan`; the same code without the dependency yields none of the two lifecycle rules while `no-empty-catch`/`no-error-details-leak` still fire |
| AC-7 | `tests/e2e/errors-lifecycle-rules.test.ts` — two `runCli --format json` runs on one tree, byte-identical stdout |
| AC-8 | same file — config `rules: { "backend-doctor/no-empty-catch": "off" }` → silent; `"error"` → exit code 1 via `expectSuccess` |
| AC-9 | existence assertions in the unit file: `valid/`+`invalid/` dirs and `docs/rules/<id>.md` for all four rules (plus every rule's snapshots themselves) |
