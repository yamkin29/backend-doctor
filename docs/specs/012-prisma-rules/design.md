# Design 012 — Rules: Prisma

## Module layout

- `src/rules/prisma/no-prisma-n-plus-one.ts` — new pack dir `prisma/` (the
  PLAN §3 layout names it); awaited-read-query-in-loop detection.
- `src/rules/prisma/no-unsafe-raw-query.ts` — raw-query candidate collection
  + the dynamic-text test over template spans and `+` chains.
- `src/rules/prisma/find-many-without-pagination.ts` — `findMany` +
  top-level `take` census.
- `src/rules/prisma/no-long-running-transaction.ts` — interactive
  `$transaction` discovery + contained-vocabulary scan.
- `src/rules/prisma/prisma-calls.ts` — the pack's small shared vocabulary:
  the read-query names, the raw-query names, `isAwaitedCall`, `isInsideLoop`,
  `isInsideNode`, `unwrapParens`, the axios-root chain walk. Helpers private
  to a rule stay in the rule file; only what ≥2 rules share moves here.
- `src/rules/index.ts` — four registrations in `productRules` (grouped
  after the nest pack).
- `src/engine/parser/types.ts` — type-only re-exports only where a
  signature must *name* a type (expected: none; `asKind` infers — same
  anticipation as spec 011). No runtime adapter changes.
- `tests/fixtures/backend-doctor/{no-prisma-n-plus-one,no-unsafe-raw-query,
  find-many-without-pagination,no-long-running-transaction}/` — flat
  fixtures (no model consulted, so the pack-directory convention buys
  nothing).
- `tests/unit/rules/prisma.test.ts` — the flat `scanFixture` pattern from
  `errors-lifecycle.test.ts` with `detectedFrameworks: ["prisma"]`, plus the
  gate case and existence assertions.
- `tests/unit/rules/blocking.test.ts` — registry count 30 → 34 (incremental
  per task: 31, 32, 33, 34).
- `tests/integration/scan.test.ts` — new `runScan` describe (AC-6).
- `tests/e2e/prisma-rules.test.ts` — bin-level tests (AC-6, AC-7, AC-8).
- `docs/rules/backend-doctor/{no-prisma-n-plus-one,no-unsafe-raw-query,
  find-many-without-pagination,no-long-running-transaction}.md` — four rule
  docs.

## Key decisions

1. **No Prisma model.** Everything is read from the file AST. Alternative —
   a `PrismaAppModel` parsed from `schema.prisma` (model/relation graph) —
   rejected: nothing in the PLAN line needs cross-file facts, parsing
   `.prisma` files means a new parser surface, and the constitution prefers
   the boring option; the model is future work if a rule ever demands it.
2. **No per-file `@prisma/client` import gate inside the pack.** The pack
   gate (`frameworks: ["prisma"]`) plus Prisma-specific method names are the
   precision boundary. Alternative — `specifiers: ["@prisma/client"]` in
   every `findModuleApiCalls` call — rejected: the canonical Nest idiom
   injects a PrismaService (`this.prisma.user.findMany(...)`), so service
   files never import `@prisma/client` and the gate would blind the pack to
   its primary audience. Method names `findMany`/`$queryRawUnsafe`/… are
   distinctive enough (Mongo driver uses `find`, Mongoose uses `find`);
   `accept` requires a property-access callee so bare same-named user
   functions never match, and `findModuleApiCalls`' own-class-member +
   same-file-shadow protections stay active.
3. **N+1 ancestry rules.** The query must be awaited (parent chain through
   parentheses ends in `AwaitExpression`) — an unawaited query in a loop is
   F005's floating-promise finding, and requiring await removes the only
   double-fire surface. Loop containment walks ancestors from the call to
   the nearest function-like boundary and looks for the five loop kinds
   (this rule carries its own list: F006's collector deliberately lacks
   `for…of`/`for…in` because sync-blocking is a different concern, while
   `for…of` is the dominant N+1 idiom). Queries inside nested functions
   (`Promise.all(users.map(...))`, async callbacks) are out — the
   `yieldsLoop` design decision 7 precedent.
4. **Dynamic-text test mirrors `containsRequestInput`.** A template literal
   is dynamic when `getTemplateSpans().length > 0`; a `+` chain is dynamic
   when any leaf operand is not a `StringLiteral` (recursion over
   `PlusToken` binaries, parens unwrapped); for `$queryRawUnsafe`/
   `$executeRawUnsafe` any other non-literal first argument (identifier,
   call, conditional) is dynamic — the API's contract is "you built the
   string yourself", so untracked provenance is the finding. Tagged-template
   calls (`prisma.$queryRaw`…``) are `TaggedTemplateExpression`s, not
   `CallExpression`s, and never reach the rule; a `TaggedTemplateExpression`
   *argument* tagged `Prisma.sql` counts as safe composition. Alternative —
   also flagging plain-call `$queryRaw(string)` as a misuse regardless of
   dynamism — rejected: runtime validation is Prisma's job; the PLAN bullet
   is string concatenation.
5. **Pagination reads the call's own argument object only.**
   `findMany()` → flagged; `findMany({ where, orderBy })` → flagged;
   `findMany({ take })` (shorthand included — `PropertyAssignment` named
   `take`) → silent; `findMany(...opts)` / `findMany(opts)` → silent
   (cannot prove unbounded). Nested `include` shapes are out (Non-goals);
   note the outer query without `take` is still flagged even when an
   included relation paginates — the outer result set is the unbounded one.
6. **Transaction containment, not re-traversal.** Vocabulary candidates come
   from two file-level `findModuleApiCalls` passes (shadow + own-member
   protections reused), then an ancestor walk keeps only candidates
   contained in a given transaction callback — with **no** function-boundary
   stop, so a `setTimeout` inside a `new Promise` executor inside the
   callback still counts (the transaction waits on it). `fetch`/axios calls
   must additionally be awaited: an unawaited `fetch` does not make the
   transaction long-running, and it is already F005's floating-promise
   finding — the await requirement is what partitions the rules. Timers
   never await (Node returns a `Timeout`), so their signal is presence, not
   await. The array form `$transaction([…])` never matches (first argument
   is not a function). Axios-root matching unwraps the receiver chain to its
   root identifier (the `isRequestRootedChain` walk, spec 007 symmetry);
   method names `get/post/put/patch/delete/request` are only matched on that
   root, so `map.get` and friends never enter the candidate set at all.
7. **Pack placement and registry order.** All four rules live in the new
   `src/rules/prisma/` directory and register after the nest pack, keeping
   `productRules` grouped by pack; the count assertion steps 31 → 34 with
   each green task so every commit is internally consistent.
8. **Determinism.** Each rule is one or more `forEachDescendant` passes over
   the file (source order) plus fixed-string vocabularies; messages are
   template strings over names already in the AST. No clocks, no
   environment reads, no iteration-order hazards (Sets/Maps hold file-local
   names inserted in source order and only membership-tested).
9. **Flat fixtures, not a pack directory.** The `tests/fixtures/nest/…`
   convention exists because F009–F011 rules need the extracted Nest model
   built over a multi-file mini-app. Prisma rules consult no model, so the
   flat convention with `detectedFrameworks: ["prisma"]` is sufficient and
   simpler.

## Dependencies

None (resolution 4). All helpers are internal imports
(`findModuleApiCalls`, `nearestFunctionLike`, `isInsideFunctionLike`); no
package.json change.

## Test map (AC → test)

| AC | Test |
|---|---|
| AC-1 | `tests/unit/rules/prisma.test.ts` — `no-prisma-n-plus-one` invalid fixtures (`for-of-await.ts`, `for-await.ts`, `while-await.ts`) exact diagnostics; valid (`batched-in.ts`, `promise-all-map.ts`, `await-before-loop.ts`, `floating-in-loop.ts`, `own-find-many.ts`) → `[]`; fixture+doc existence |
| AC-2 | same file — `no-unsafe-raw-query` invalid (`template-unsafe.ts`, `concat-unsafe.ts`, `plain-call-dynamic.ts`) exact diagnostics; valid (`tagged-template.ts`, `literal-unsafe.ts`, `prisma-sql.ts`, `no-span-template.ts`) → `[]`; existence |
| AC-3 | same file — `find-many-without-pagination` invalid (`no-args.ts`, `no-take.ts`) exact diagnostics; valid (`with-take.ts`, `take-shorthand.ts`, `spread-args.ts`, `find-first.ts`) → `[]`; existence |
| AC-4 | same file — `no-long-running-transaction` invalid (`fetch-inside.ts`, `timer-inside.ts`, `axios-inside.ts`) exact diagnostics; valid (`db-only.ts`, `external-before.ts`, `array-form.ts`) → `[]`; existence |
| AC-5 | the four `valid` fixture sets assert `[]` (covered by AC-1..4 rows) |
| AC-6 | unit gate case (`detectedFrameworks: []` → no pack diagnostics); `tests/integration/scan.test.ts` — staged tree with `@prisma/client` in `package.json` yields pack diagnostics via `runScan` with `"prisma"` in `projects[0].frameworks`; the same sources without the dependency yield none |
| AC-7 | `tests/e2e/prisma-rules.test.ts` — two `runCli --format json` runs on one tree, byte-identical stdout |
| AC-8 | same file — config turning a pack rule `off` → silent; `error` → exit code 1 via `expectSuccess` |
| AC-9 | existence assertions in the unit file: `valid/`+`invalid/` dirs and `docs/rules/<id>.md` for all four rules (plus every rule's snapshots themselves) |
