# Design 006 — Event-loop blocking rules (F006)

## 1. Module layout

| File | Purpose |
|------|---------|
| `src/rules/blocking/sync-module-calls.ts` | Shared collector for the two module-API rules: import-gate check, same-file shadow set, `this`-member guard, yields candidate calls (property or bare-identifier form) whose callee name is in a given set. |
| `src/rules/blocking/sync-fs.ts` | Rule `backend-doctor/no-sync-fs-in-request-path`. |
| `src/rules/blocking/sync-crypto.ts` | Rule `backend-doctor/no-sync-crypto` (adds the `randomBytes`/`randomFill` no-callback predicate). |
| `src/rules/blocking/cpu-bound-loop.ts` | Rule `backend-doctor/no-cpu-bound-loop` (loop condition literal-bound check + await-yield check). |
| `src/rules/index.ts` | Three new entries in `productRules`. |
| `src/engine/parser/types.ts` | No changes planned (decision 9); grows only if tsc proves ts-morph's `asKind` overloads insufficient. |
| `tests/fixtures/backend-doctor/<short-id>/{valid,invalid}/` | Per-rule fixtures (list pinned in §3). |
| `tests/unit/rules/blocking.test.ts` | Unit pack (mirrors `async.test.ts`). |
| `tests/integration/scan.test.ts` | Extended with a blocking-rules describe. |
| `tests/e2e/blocking-rules.test.ts` | e2e through the built bin. |
| `docs/rules/backend-doctor/{no-sync-fs-in-request-path,no-sync-crypto,no-cpu-bound-loop}.md` | Rule docs (constitution §3). |

`isInsideFunctionLike` is reused from `src/rules/async/async-calls.ts` (cross-pack
internal import, spec open question 6).

## 2. Key decisions

1. **One shared collector, two consumers.** `findSyncModuleCalls(file, opts)`
   (specifiers + name set + optional per-call `accept` predicate) serves both
   fs and crypto rules. Alternative: duplicate callee matching in each rule —
   rejected (drift risk); extend `async-calls.ts` — rejected (that module owns
   async-binding semantics; this is a different concern).
2. **Any-scope shadow suppression for bare identifiers.** A bare callee name
   is suppressed when any same-file function declaration or variable statement
   declares that name. Alternative: spec 005's nearest-scope resolution —
   rejected: for fs/crypto names any same-file binding is almost certainly a
   user wrapper (suppressing is the precision-safe reading), TS redeclaration
   rules make import-vs-function collisions impossible, so over-suppression
   costs only recall, never precision.
3. **Property-form receiver unconstrained, with a `this`-member guard.**
   `<recv>.existsSync()` is flagged for any receiver (default/namespace import
   local names vary and the adapter does not expose import bindings) EXCEPT
   `this.<member>` where the nearest enclosing class declares `<member>` — a
   class method named like an fs call is user code, not fs. Alternative:
   constrain receiver to the import's local name — rejected (unresolvable
   without import-binding analysis).
4. **Import gate = module-specifier spellings.** `fs`, `node:fs`,
   `fs/promises`, `node:fs/promises`; `crypto`, `node:crypto` — checked via
   the existing `SourceFileView.getModuleSpecifiers()` (covers static import,
   `require`, dynamic `import`). Alternative: no gate — rejected (open
   question 3, FP budget).
5. **`randomBytes`/`randomFill` async-form exemption by argument count.** The
   sync form is `randomBytes(size)`; a second argument is the callback
   (`getArguments().length >= 2` → async → not flagged). Alternative:
   type-aware callback detection — rejected (no typechecker). Spread-only
   argument lists are indistinguishable — documented recall hole.
6. **Loop heuristic shape.** `for`/`while`/`do…while` inside a function body,
   whose condition is a BinaryExpression with `<`, `>`, `<=`, `>=` (either
   operand order) against a numeric literal ≥ 10,000, and whose body does not
   yield. Literal normalization: strip `_`, then `Number()` (also handles
   `0x…`/exponent forms). Alternatives: `while (true)` detection — rejected
   (needs reachability analysis; deferred to post-F022); counting iterations
   exactly for `<=` (`i <= 9999` = 10 000 iterations) — rejected as
   over-clever, the literal value is compared directly (recall gap recorded
   in the rule doc).
7. **Await-yield check via ancestor walk.** The file pass collects
   `AwaitExpression` nodes; a loop yields iff some await's ancestor chain
   (walking `getParent()`, stopping at any function-like node) contains the
   loop node. Awaits inside nested async arrows therefore do NOT yield the
   loop (they run concurrently; the loop still blocks) — correct by
   construction. Alternative: `Node#forEachDescendant` over the loop body —
   rejected (ancestor walking is the established spec 005 pattern and avoids
   traversal-control pitfalls documented in RESEARCH.md).
8. **One static message per rule** — no per-finding interpolation, matching
   all six existing rules; keeps reports byte-identical and snapshot tests
   simple. Messages:
   - fs: `Synchronous fs calls block the event loop for the whole I/O, stalling every concurrent request. Use the promise API (fs/promises) or await fs.promises instead.`
   - crypto: `Synchronous crypto work (key derivation, random bytes) blocks the event loop for the full computation. Use the callback or promisified async API instead.`
   - loop: `This loop runs a literal-bounded body of at least 10,000 iterations without awaiting, so it blocks the event loop for the whole run. Move heavy CPU work off the request path or chunk it with setImmediate.`
9. **Adapter grows only on demonstrated need.** Spec anticipated type
   re-exports (`ForStatement`, `WhileStatement`, `DoStatement`); ts-morph's
   typed `asKind` overloads likely make them unnecessary. Implement first;
   add re-exports only if tsc demands them, and record either outcome in
   tasks.md deviations (spec 003 design §1 principle: grow when the first
   rule needs more).
10. **Unconditional execution.** No `frameworks` gate — "request path" is
    approximated by "inside any function body" until F008/F013/F019 provide
    attribution; every recall hole lands in the rule docs' Scope notes.

### Pinned name sets

- **SYNC_FS_METHODS** (the sync surface of the `node:fs` callback API):
  `accessSync, appendFileSync, chmodSync, chownSync, closeSync, copyFileSync,
  cpSync, existsSync, fchmodSync, fchownSync, fdatasyncSync, fsyncSync,
  ftruncateSync, futimesSync, lchmodSync, lchownSync, linkSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, opendirSync, readFileSync, readSync,
  readvSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync,
  rmdirSync, statSync, symlinkSync, truncateSync, unlinkSync, utimesSync,
  writeFileSync, writeSync, writevSync`.
- **CRYPTO_ALWAYS** (always sync): `pbkdf2Sync, scryptSync,
  generateKeyPairSync, generatePrimeSync, hkdfSync, randomFillSync`.
- **CRYPTO_WHEN_NO_CALLBACK**: `randomBytes, randomFill` — flagged only when
  `getArguments().length < 2` (decision 5).
- Not flagged (scope notes): `createHash`/`createCipheriv` (cheap), sync
  `crypto.sign`/`crypto.verify` (rare in v1 scope), promise APIs.

## 3. Fixtures (pinned; supersedes the indicative list in spec.md)

`tests/fixtures/backend-doctor/…`, one finding per invalid file:

- **no-sync-fs-in-request-path**
  - invalid: `property-fs.ts` (default-import `fs.readFileSync` in a
    function), `named-import.ts` (bare `readFileSync`), `nested-function.ts`
    (call inside a returned arrow — nested bodies count).
  - valid: `top-level.ts` (module top level), `promises-api.ts` (`readFile`/
    `appendFile` from `node:fs/promises`), `own-function.ts` (bare
    `existsSync` shadowed by a same-file function; gate satisfied via
    `fs.readFile`), `own-method.ts` (`this.existsSync()` on a class that
    declares the member), `no-fs-import.ts` (`cache.readFileSync` in a file
    with no fs specifier).
- **no-sync-crypto**
  - invalid: `pbkdf2-sync.ts` (`crypto.pbkdf2Sync`), `scrypt-sync.ts` (bare
    `scryptSync`), `random-bytes-sync.ts` (bare `randomBytes`, no callback).
  - valid: `top-level.ts` (module top level), `random-bytes-callback.ts`
    (two-argument form), `async-kdf.ts` (`promisify(pbkdf2)`),
    `no-crypto-import.ts` (own `crypto` object, no specifier).
- **no-cpu-bound-loop**
  - invalid: `for-literal.ts` (`i < 100_000`), `while-literal.ts`
    (`i < 250_000`), `do-while-literal.ts` (`i < 500_000`).
  - valid: `below-threshold.ts` (`i < 9_999`), `await-in-body.ts` (large
    bound + `await` in body), `variable-bound.ts`, `computed-bound.ts`
    (`i < 2 ** 31`).

`bad-app` and the async integration/e2e temp trees contain no fs calls,
crypto calls or loops (verified against `tests/fixtures/engine/bad-app/src/`
and the staging code in the existing tests) — pinned expectations stay valid.

## 4. Dependencies

None new (spec open question 6). The only cross-module reuse is
`isInsideFunctionLike` from `src/rules/async/async-calls.ts`.

## 5. Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/unit/rules/blocking.test.ts` — fs invalid fixtures produce exact diagnostics (file/line/column/message/severity/category) |
| AC-2 | fs `valid/top-level.ts` → `[]` |
| AC-3 | fs `valid/{promises-api,own-function,own-method,no-fs-import}.ts` → `[]` |
| AC-4 | crypto invalid `pbkdf2-sync.ts`, `scrypt-sync.ts` → exact diagnostics |
| AC-5 | crypto invalid `random-bytes-sync.ts` flagged; `valid/random-bytes-callback.ts` → `[]` |
| AC-6 | crypto `valid/{no-crypto-import,top-level}.ts` → `[]` |
| AC-7 | loop invalid `{for,while,do-while}-literal.ts` → exact diagnostics |
| AC-8 | loop `valid/{below-threshold,await-in-body,variable-bound,computed-bound}.ts` → `[]` |
| AC-9 | `blocking.test.ts` registry assertion — ten product rule ids, unique |
| AC-10 | `tests/integration/scan.test.ts` (engine level: report order, escalation to `error`); `tests/e2e/blocking-rules.test.ts` (exit 0 warn → escalate → exit 1; `off` removes diagnostics) |
| AC-11 | e2e: two consecutive json scans byte-identical |
