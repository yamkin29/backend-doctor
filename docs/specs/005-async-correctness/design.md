# Design 005 — Async-correctness rules (F005)

Implements [spec.md](./spec.md) (Approved 2026-09-19). All open questions
resolved as recommended; no new dependencies.

## Module layout

| File | Purpose |
|------|---------|
| `src/engine/parser/types.ts` (edit) | Re-export the additional ts-morph types the rules need (`ArrowFunction`, `ClassDeclaration`, `ConstructorDeclaration`, `FunctionDeclaration`, `FunctionExpression`, `MethodDeclaration`, `PropertyDeclaration`, `TryStatement`, `VariableDeclaration`) — constitution §4: the adapter vocabulary grows first. No new `SourceFileView` methods; rules compose the existing `forEachDescendant` / `getText` / Node-guard surface. |
| `src/rules/async/async-calls.ts` (new) | Shared heuristic module (not a rule): same-file async-declaration index + statement-level async-call candidates. Consumed by `no-floating-promises` and `no-async-constructor-work`. |
| `src/rules/async/no-floating-promises.ts` (new) | Rule: statement-level async calls outside constructors. |
| `src/rules/async/no-async-constructor-work.ts` (new) | Rule: the same candidate forms restricted to constructor bodies. |
| `src/rules/async/no-async-foreach-callback.ts` (new) | Rule: `X.forEach(async …)`. |
| `src/rules/async/unhandled-json-parse.ts` (new) | Rule: unguarded `JSON.parse` inside function bodies. |
| `src/rules/async/no-unhandled-emitter-error.ts` (new) | Rule: `new EventEmitter()` receivers emitting `'error'` without a listener. |
| `src/rules/index.ts` (edit) | Append the five rules to `productRules`. |
| `tests/unit/rules/async-calls.test.ts` (new) | Unit tests of the shared heuristic (T1). |
| `tests/unit/rules/async.test.ts` (new) | Fixture-based per-rule diagnostics + registry assertion (T2–T6). |
| `tests/fixtures/backend-doctor/<short-id>/{valid,invalid}/*.ts` (new) | Fixtures per constitution §3, as listed in the spec. |
| `tests/integration/scan.test.ts` (edit) | Temp-project runScan assertions + severity escalation (T7). |
| `tests/e2e/async-rules.test.ts` (new) | Bin-level: json diagnostics, exit-code escalation, byte-identity (T7). |
| `docs/rules/backend-doctor/<id>.md` ×5 (new) | Rule docs per constitution §3 (T8). |

## Key decisions

1. **One shared heuristic module, two scopes.** `findStatementLevelAsyncCalls`
   returns candidates tagged with their nearest function-like ancestor
   (`inConstructor: boolean`); `no-floating-promises` filters `!inConstructor`,
   `no-async-constructor-work` filters `inConstructor`. Alternative: two
   independent implementations — rejected, they would drift (the spec's
   contract defines one candidate set).
2. **Scope-aware same-file callee resolution.** The index maps a name to every
   same-file binding (`function` declarations and variable declarations with
   async/sync arrow or function initializers) together with its scope root
   (nearest enclosing function-like node, or the SourceFile for module level).
   For a call, the *nearest enclosing* binding wins; bodyless overload
   signature declarations are ignored (no runtime binding). This satisfies
   AC-1 + AC-5 simultaneously (module-level async fn called outside the
   shadowing scope is still flagged). Alternative: ambiguity-skip when a name
   has both async and non-async bindings — rejected, it silently loses the
   AC-1 module-level case the fixture pins.
3. **`void` suppression is structural, not special-cased.** `void load()` is an
   ExpressionStatement wrapping a VoidExpression, so the statement expression
   is not a CallExpression and no candidate is produced (verified against
   ts-morph 28). Same for `await` (AwaitExpression) and assigned/returned/
   yielded forms — the statement-level shape check covers AC-4 wholesale.
4. **Statement-level check.** A CallExpression is statement-level when its
   parent, after unwrapping ParenthesizedExpression, is an ExpressionStatement.
   Chained calls (`load().then(cb)`) fail the callee-form match (callee is a
   PropertyAccess named `then`), matching the approved minimal scope.
5. **`this.<method>()` resolution.** For a `this.X` callee, take the nearest
   enclosing ClassDeclaration/ClassExpression of the *call* and check its
   members: async `MethodDeclaration`s and `PropertyDeclaration`s initialized
   with an async arrow/function. Per-class resolution keeps two same-named
   methods in different classes from cross-matching. Inherited members are not
   resolved (documented recall hole).
6. **`fetch` is a bare identifier** not bound anywhere in the file (any
   same-file binding shadows the global and suppresses). `globalThis.fetch(…)`
   is a property access and is not matched (documented).
7. **Emitter tracking by receiver text key.** Keys come from
   `new EventEmitter()` initializers: `const x = new EventEmitter()` → `x`;
   `this.x = new EventEmitter()` (property initializer or constructor
   assignment) → `this.x`. A key with more than one initializer in the file is
   dropped entirely (ambiguity, precision-first). Findings are emitted per
   `emit` call site whose first argument is the string literal `"error"` when
   the same key has no `on/once/addListener/prependListener("error")`
   registration anywhere in the file. Receivers used across function
   boundaries are never tracked (AC-15).
8. **`unhandled-json-parse` guard check.** Flag when the call has at least one
   function-like ancestor (inside a function body) and no ancestor
   TryStatement with `getCatchClause() !== undefined` (a finally-only try does
   not guard — verified against ts-morph 28). Module top level (no function
   ancestor) is exempt per approved open question 3.
9. **One message per rule** (like `no-eval`) — deterministic output, stable
   ids; exact texts below.
10. **No new `SourceFileView` API.** Rules compose `forEachDescendant`,
    `getText`, Node type guards and `getParent()` — all part of the
    established vocabulary (`no-eval` precedent). Alternative: an adapter
    `forEachAncestor` helper — rejected as unnecessary surface.
11. **ts-morph traversal gotcha (verified).** `forEachDescendant` treats the
    callback's return value as traversal control: returning a truthy value
    (e.g. `nodes.push(n)`'s number) aborts the traversal. Rule callbacks
    return `undefined` explicitly (the `no-eval` pattern). Recorded in
    RESEARCH.md.
12. **Fixture positions.** Biome enforces tabs; a tab is one column for
    `getLineAndColumnAtPos`, so indented statements land at column 2/3.
    Expected line/column pairs in tests are derived from the formatted fixture
    bytes, re-checked after `pnpm format`.

## Messages

- `no-floating-promises`: `This call returns a promise that is neither awaited nor handled; its rejection is silently lost. Add await, a .catch handler, or the void operator if fire-and-forget is intended.`
- `no-async-foreach-callback`: `Array.forEach does not await async callbacks, so iteration order is lost and rejections go unhandled. Use for…of with await or Promise.all(items.map(...)).`
- `unhandled-json-parse`: `JSON.parse throws on malformed input and this call is not guarded by try/catch; a bad payload will crash this code path. Guard it or validate the input first.`
- `no-async-constructor-work`: `Constructor starts async work without awaiting it; initialization races with first use. Move the work into an explicit init method that callers can await.`
- `no-unhandled-emitter-error`: `This emitter emits 'error' with no 'error' listener registered; Node.js raises an uncaught exception for unhandled 'error' events. Register a listener or remove the emit.`

## Dependencies

None added (approved open question 8). ts-morph 28 only.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/unit/rules/async-calls.test.ts` (candidate forms: async fn decl, async arrow var, nested-scope nearest-binding) + `async.test.ts` → `no-floating-promises` invalid `async-fn.ts`, `async-arrow.ts` (exact file/line/column/message/severity/category) |
| AC-2 | `async-calls.test.ts` (fetch candidate; shadowed fetch suppressed) + `async.test.ts` → invalid `fetch.ts` |
| AC-3 | `async-calls.test.ts` (this-method candidate; wrong-class `this.X` not a candidate) + `async.test.ts` → invalid `this-method.ts` |
| AC-4 | `async-calls.test.ts` (await/void/assigned/returned/chained produce no candidates) + `async.test.ts` → valid `awaited.ts`, `void-prefixed.ts`, `chained.ts`, `assigned.ts`, `returned.ts` |
| AC-5 | `async-calls.test.ts` (sync local shadows async outer inside its scope) + `async.test.ts` → invalid `shadowed-local.ts` (inner silent, outer flagged), valid `shadowed-sync.ts` |
| AC-6 | `async-calls.test.ts` (constructor-tagged candidate) + `async.test.ts` → valid `constructor-owned.ts` (floating silent; T3 flags it) |
| AC-7 | `async.test.ts` → `no-async-foreach-callback` invalid `async-arrow.ts`, `async-function.ts` |
| AC-8 | `async.test.ts` → valid `sync-callback.ts`, `map-promise-all.ts`, `for-of-await.ts` |
| AC-9 | `async.test.ts` → `unhandled-json-parse` invalid `in-function.ts` |
| AC-10 | `async.test.ts` → valid `try-catch.ts`, `module-top-level.ts` (+ finally-only try in `try-catch.ts`) |
| AC-11 | `async.test.ts` → `no-async-constructor-work` invalid `this-method.ts`, `helper-fn.ts`, `fetch.ts` |
| AC-12 | `async.test.ts` → valid `void-init.ts`, `sync-only.ts` |
| AC-13 | `async.test.ts` → `no-unhandled-emitter-error` invalid `emit-no-listener.ts`, `this-emitter.ts` |
| AC-14 | `async.test.ts` → valid `with-listener.ts`, `other-event.ts` |
| AC-15 | `async.test.ts` → valid `passed-to-function.ts`, `subclass.ts` |
| AC-16 | `async.test.ts` registry block: all five ids registered, seven product rules, no duplicates |
| AC-17 | `tests/integration/scan.test.ts` (escalation to error at engine level) + `tests/e2e/async-rules.test.ts` (exit 1 through the bin; `off`/`ignore.rules` → no diagnostics) |
| AC-18 | `tests/e2e/async-rules.test.ts` (two consecutive json runs byte-identical) |
