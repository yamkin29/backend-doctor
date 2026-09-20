# Spec 012 — Rules: Prisma (F012)

- **Status:** Draft — pending review
- **Phase:** 2 — Nest specifics & Prisma
- **Depends on:** F004 (framework detection — the `prisma` markers already
  ship) — Done; F003 (engine core, pack gate) — Done; F005/F006/F007 (shared
  rule helpers: `findModuleApiCalls`, function-like/loop ancestry, chain
  walking) — Done; F011 (pack + fixture + doc patterns this spec reuses) —
  Done
- **Blocks:** F022 (eval corpus consumes this pack)

## Problem

Prisma is the first supported ORM (PLAN decision) and the `prisma` framework
markers already activate detection (`@prisma/client` dependency/import,
`prisma/schema.prisma`), yet no rule consumes the pack: the four failure
modes of the PLAN line go unreported — N+1 queries (a query awaited inside a
loop, one round-trip per iteration), raw-query text built by string
concatenation (the SQL-injection vector Prisma's `*Unsafe` APIs invite),
`findMany` without `take` (an unbounded result set that scales with the
table, not the request), and long-running interactive transactions (row
locks held while the callback waits on external I/O). All four degrade
production backends in ways unit tests rarely catch, and all four are
recognizable from syntax alone at the established precision bar. No new
model, adapter runtime, or contract surface is needed: the pack gate, the
`findModuleApiCalls` protections and the loop/ancestry helpers from F005–F011
cover everything.

## Goals

- Four new rules, all default `warn` (constitution §2), all gated
  `frameworks: ["prisma"]` (the existing pack gate — disabled by design when
  Prisma is not detected), living in a new `src/rules/prisma/` module (the
  PLAN §3 layout names the `prisma/` rules subdirectory):
  - `backend-doctor/no-prisma-n-plus-one` (Performance) — a Prisma read
    query (`findMany`, `findFirst`, `findUnique`, `findFirstOrThrow`,
    `findUniqueOrThrow`, `count`, `aggregate`, `groupBy`) that is **awaited**
    and sits lexically inside a loop body (`for`, `for…of`, `for…in`,
    `while`, `do…while`) within a function. One diagnostic per query call.
  - `backend-doctor/no-unsafe-raw-query` (Security) — a raw-query API call
    (`$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe`)
    whose query text is dynamic: a template literal with at least one
    interpolation, a `+` concatenation with a non-literal operand, or — for
    the `*Unsafe` variants, whose contract is "you built the string yourself"
    — any non-literal first argument. One diagnostic per call.
  - `backend-doctor/find-many-without-pagination` (Performance) — a
    `findMany` call with no argument, or an object-literal argument without
    a `take` property. One diagnostic per call.
  - `backend-doctor/no-long-running-transaction` (Performance) — inside an
    interactive `$transaction(async (tx) => …)` callback: an awaited bare
    `fetch`, an awaited member call on an `axios`-rooted receiver, or a
    `setTimeout`/`setInterval` call. One diagnostic per offending call.
- Precision gates (constitution §2):
  - N+1: the call must be awaited (an unawaited query in a loop is F005's
    floating-promise business — no double-fire) and directly in the loop
    body; queries inside nested functions (arrows, callbacks) are out — the
    nearest-function-like-ancestor rule decides (the `no-cpu-bound-loop`
    `yieldsLoop` precedent). Write calls (`create`/`update`/…) are not in
    the vocabulary. Own-class members (`this.findMany()` on a class
    declaring `findMany`) and same-file-shadowed bare identifiers stay
    silent (the `findModuleApiCalls` protections, reused).
  - Raw queries: the safe forms stay silent — the tagged-template call
    ``prisma.$queryRaw`…${value}…` `` (values become parameters; not a
    `CallExpression`, so it is invisible to the rule by construction),
    `Prisma.sql`-composed arguments, fully literal strings, and
    interpolation-free template literals.
  - Pagination: only the call's own top-level argument object is inspected;
    `findFirst`/`findUnique` are single-row by design and never fire; a
    non-object-literal argument (variable, spread-only) is unknown and stays
    silent.
  - Transactions: only the interactive (callback) form; the array form
    `$transaction([…])` is a fixed batch and never fires. `await`-less
    `fetch`/`axios` calls do not make the transaction wait and are F005's
    business — no double-fire.
- No model, report, or contract changes: no Prisma equivalent of the Nest
  app model is introduced; everything is read from the file AST under the
  established helpers. `schemaVersion` stays 1, exit codes stay 0/1/2, no
  new CLI flags or config fields, reporters untouched, no new dependencies.
- Determinism (constitution §1): all findings derive from the file AST and
  fixed constants; two scans are byte-identical.

## Non-goals

- Type-aware analysis (the TS checker): "this receiver is a PrismaClient"
  recognition stays name/shape-based — the engine stays syntax-only
  (spec 003). The `frameworks: ["prisma"]` gate plus Prisma-specific method
  names (`findMany`, `$queryRawUnsafe`, …) are the precision boundary.
- Write-call N+1 (`create`/`update`/`upsert`/`delete` in loops): the batch
  fixes (`createMany`, `updateMany`, one transaction) are idiomatic but
  dependent-row creations have legitimate loop shapes; if the F022 eval
  corpus asks for it, extending the vocabulary is a later, measured change.
- Nested-relation pagination (`include: { posts: { take: 5 } }`): the rule
  bounds only the call's own result set; bounding every included relation is
  a different (and noisier) check.
- A Prisma app model (schema.prisma parsing, model/relation graph): nothing
  in the PLAN line needs cross-file facts; schema parsing is future work if
  a rule ever demands it.
- Raw-query policy beyond dynamic text: flagging every `*Unsafe` use (even
  literal), auditing `Prisma.raw`, or checking `$transaction` timeout
  options — the PLAN bullet is "raw query string concatenation"; broader
  policy is out of scope.
- `$transaction` in loops (a per-iteration transaction) and transaction
  nesting: adjacent anti-patterns, not in the PLAN line.
- Other ORMs (TypeORM/Mongoose query-in-loop shapes) — explicitly out of
  scope per PLAN §6.
- Diff scope, runtime attribution (F019/F020 own runtime N+1 detection),
  new dependencies, exit-code/`schemaVersion`/CLI/reporter changes.

## User stories

1. As a backend developer, I run `backend-doctor scan .` and get a warning
   at each query awaited per loop iteration, each raw query built from
   interpolated or concatenated strings, each `findMany` that loads the
   whole table, and each transaction that waits on `fetch` or a timer while
   holding locks — each message naming the concrete fix (batch with
   `include`/`id IN`, tagged templates/`Prisma.sql`, `take`, move I/O out of
   the transaction), without flagging my parameterized tagged templates, my
   `Promise.all` fan-outs, or my array-form transactions.
2. As a CI author, the pack behaves like every other pack: `warn` by default
   so the exit code stays 0 until I promote rules, `--format json|jsonl`
   unchanged, consecutive runs byte-identical, and a repo without
   `@prisma/client` produces none of the pack findings.
3. As an AI agent, I consume the same JSON/JSONL as before — no new schema
   surface — and every finding cites a rule doc at
   `docs/rules/backend-doctor/<rule-id>.md` with bad/good Prisma examples.

## Contract / Model

No changes to the JSON report, CLI surface, config fields, exit codes, or
the parser adapter's runtime API (type-only re-export growth only, per the
established precedent — constitution §4). The only new stable surfaces are
the four rule ids below.

### Rules (default severity `warn`, gate `frameworks: ["prisma"]`)

| Rule id | Category | Fires at | One diagnostic per |
|---|---|---|---|
| `backend-doctor/no-prisma-n-plus-one` | Performance | the awaited query call | awaited read query in a loop body |
| `backend-doctor/no-unsafe-raw-query` | Security | the raw-query call | call carrying dynamic query text |
| `backend-doctor/find-many-without-pagination` | Performance | the `findMany` call | unbounded `findMany` |
| `backend-doctor/no-long-running-transaction` | Performance | the offending call inside the callback | external-I/O/timer call in an interactive transaction |

Per-rule semantics:

- **no-prisma-n-plus-one** — candidates via `findModuleApiCalls` (no
  specifiers gate: the pack gate plus Prisma-specific method names are the
  boundary; the Nest idiom injects a PrismaService, so a per-file
  `@prisma/client` import gate would miss most call sites), names = the
  eight read queries, `accept` requires a property-access callee (bare
  `findMany()` is not a Prisma shape). Keep a candidate when it is awaited
  (parent chain through parentheses ends in an `AwaitExpression`) and the
  ancestor walk from the call to its nearest function-like ancestor crosses
  one of the five loop kinds. Loop vocabulary is this rule's own (F006's
  collector deliberately lacks `for…of`/`for…in` — sync-blocking loops are a
  different concern); function-body scoping and shadow/own-member
  protections come from `findModuleApiCalls` unchanged.
- **no-unsafe-raw-query** — candidates via `findModuleApiCalls`, names =
  the four `$`-APIs, `insideFunctionBodies: false` (an injection path does
  not become safe at module top level — the spec 007 precedent), `accept`
  requires a property-access callee. Dynamic-text test on the first
  argument: a `TemplateExpression` with ≥1 span is dynamic; a `+` chain is
  dynamic when any leaf operand is not a `StringLiteral` (walk mirrors
  `containsRequestInput`); for `$queryRawUnsafe`/`$executeRawUnsafe` any
  other non-literal argument (identifier, call) is dynamic too — the API's
  contract is untracked provenance. Tagged-template calls never reach the
  rule (not `CallExpression`s); a `TaggedTemplateExpression` argument
  tagged `Prisma.sql` counts as safe composition and stays silent.
- **find-many-without-pagination** — candidates via `findModuleApiCalls`,
  names = `["findMany"]`, `accept` requires a property-access callee.
  Report when the first argument is absent or an `ObjectLiteralExpression`
  whose properties include no `PropertyAssignment` named `take` (shorthand
  `{ take }` counts). Non-object arguments stay silent (cannot prove
  unbounded).
- **no-long-running-transaction** — locate interactive transactions:
  `$transaction` calls (property-access callee) whose first argument is an
  arrow/function expression. Vocabulary candidates via `findModuleApiCalls`
  at file level, kept when contained in a transaction callback (ancestor
  walk, no function-boundary stop — a timer inside a `new Promise` executor
  still delays the transaction): (a) bare `fetch`/`setTimeout`/`setInterval`
  (shadow + own-member protections reused) — `fetch` additionally must be
  awaited; (b) member calls named `get`/`post`/`put`/`patch`/`delete`/
  `request` on a receiver chain rooted at the identifier `axios`
  (`isRequestRootedChain`-style root walk, spec 007 symmetry) — awaited.
  Array-form `$transaction` never matches.

Message templates (exact strings, snapshot-pinned):

- `no-prisma-n-plus-one`: `This Prisma query runs once per loop iteration
  (N+1): every pass makes another database round-trip. Fetch everything in
  one query instead — load relations with include/select, or batch the ids
  with findMany({ where: { id: { in: ids } } }).`
- `no-unsafe-raw-query`: `Raw query text is built dynamically here:
  interpolated input allows SQL injection. Use the tagged-template form
  prisma.$queryRaw\`…\${value}…\` so values become parameters, or compose
  fragments with Prisma.sql / Prisma.join.`
- `find-many-without-pagination`: `findMany without take loads every
  matching row into memory; bound the result set with take (and skip or
  cursor for paging).`
- `no-long-running-transaction`: `<name> runs inside an interactive
  $transaction: the transaction holds its locks while waiting on external
  I/O. Move external calls and delays outside the transaction and keep only
  Prisma statements inside.` — `<name>` is the matched call (`fetch`,
  `setTimeout`, `setInterval`, `axios.<method>`).

## EARS acceptance criteria

- **AC-1:** WHEN a read-query call from the eight-name vocabulary is awaited
  and sits lexically inside a loop body within a function, THE SYSTEM SHALL
  report exactly one `no-prisma-n-plus-one` diagnostic (warn, Performance)
  at the call; WHEN the call is not awaited, outside a loop, in a nested
  function inside the loop, an own-class member, or a shadowed bare
  identifier, THE SYSTEM SHALL NOT report.
- **AC-2:** WHEN a `$queryRaw`/`$executeRaw`/`$queryRawUnsafe`/
  `$executeRawUnsafe` call carries dynamic query text (template literal
  with ≥1 interpolation; `+` concatenation with a non-literal operand; for
  the `Unsafe` variants any non-literal argument), THE SYSTEM SHALL report
  exactly one `no-unsafe-raw-query` diagnostic (warn, Security) at the call;
  WHEN the query is a tagged template, a `Prisma.sql` argument, a literal
  string, or an interpolation-free template literal, THE SYSTEM SHALL NOT
  report.
- **AC-3:** WHEN a `findMany` call has no argument or an object-literal
  argument without `take`, THE SYSTEM SHALL report exactly one
  `find-many-without-pagination` diagnostic (warn, Performance) at the call;
  WHEN the argument object carries `take`, the argument is not an object
  literal, or the callee is another query method, THE SYSTEM SHALL NOT
  report.
- **AC-4:** WHEN an interactive `$transaction` callback contains an awaited
  bare `fetch`, an awaited `axios`-rooted member call, or a
  `setTimeout`/`setInterval` call, THE SYSTEM SHALL report exactly one
  `no-long-running-transaction` diagnostic (warn, Performance) at that call;
  WHEN the callback holds only Prisma calls, the array form is used, or the
  external call sits outside the callback, THE SYSTEM SHALL NOT report.
- **AC-5:** WHEN the scanned file contains none of the pack's triggers, THE
  SYSTEM SHALL produce no diagnostics from this pack for that file.
- **AC-6:** WHEN prisma is not among the detected frameworks, THE SYSTEM
  SHALL produce no diagnostics from these four rules while the rest of the
  registry runs unchanged, with unchanged exit codes.
- **AC-7:** WHEN the same tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports.
- **AC-8:** WHEN config sets a pack rule to `"off"` THE SYSTEM SHALL produce
  no diagnostics for it, and WHEN set to `"error"` THE SYSTEM SHALL escalate
  its severity (exit code 1 when such diagnostics exist).
- **AC-9:** WHEN the feature ships, every pack rule SHALL have `valid/` and
  `invalid/` fixtures, snapshot tests of the exact diagnostics, and a
  markdown doc at `docs/rules/<rule-id>.md` (constitution §3).

## Testing strategy (TDD)

- **Fixtures.** All four rules use the flat convention
  (`tests/fixtures/backend-doctor/<rule-id>/{valid,invalid}/`): unlike the
  F009–F011 Nest rules, no app model is consulted, so the pack-directory
  convention buys nothing (the spec 010 precedent is for model-dependent
  rules). Unit scans pass `detectedFrameworks: ["prisma"]`.
  - `no-prisma-n-plus-one/` — invalid: `for-of-await.ts` (outer
    `findMany`, then a `for…of` with an awaited `findMany` inside),
    `for-await.ts` (awaited `findUnique` in a classic `for`),
    `while-await.ts` (awaited `count` in a `while`); valid:
    `batched-in.ts` (single `findMany({ where: { id: { in: ids } } })`),
    `promise-all-map.ts` (`Promise.all(users.map(...))` — nested function,
    parallel), `await-before-loop.ts` (query awaited before the loop),
    `floating-in-loop.ts` (unawaited query in a loop — F005's business),
    `own-find-many.ts` (`this.findMany()` on a class declaring it) (AC-1).
  - `no-unsafe-raw-query/` — invalid: `template-unsafe.ts`
    (`$queryRawUnsafe(`` `…${name}…` ``)), `concat-unsafe.ts`
    (`$executeRawUnsafe("…" + name)`), `plain-call-dynamic.ts`
    (`$queryRaw(`` `…${x}…` `` as a plain call argument); valid:
    `tagged-template.ts` (`` prisma.$queryRaw`…${x}…` ``),
    `literal-unsafe.ts` (`$queryRawUnsafe("SELECT 1")`),
    `prisma-sql.ts` (`$queryRawUnsafe(Prisma.sql`…`)`),
    `no-span-template.ts` (`$queryRawUnsafe(``` `SELECT 1` ```)`) (AC-2).
  - `find-many-without-pagination/` — invalid: `no-args.ts`,
    `no-take.ts` (`{ where, orderBy }` only); valid: `with-take.ts`,
    `take-shorthand.ts` (`{ take, skip }`), `spread-args.ts`
    (`findMany(...opts)`), `find-first.ts` (AC-3).
  - `no-long-running-transaction/` — invalid: `fetch-inside.ts`,
    `timer-inside.ts` (`new Promise((r) => setTimeout(r, 500))` inside the
    callback), `axios-inside.ts`; valid: `db-only.ts`,
    `external-before.ts` (`fetch` before the transaction, writes inside),
    `array-form.ts` (AC-4).
- **Unit** — new `tests/unit/rules/prisma.test.ts`: the flat-fixture
  pattern from `tests/unit/rules/errors-lifecycle.test.ts` (`scanFixture` +
  exact-diagnostics `toEqual`) with `detectedFrameworks: ["prisma"]`, plus a
  gate case (`detectedFrameworks: []` → no diagnostics, AC-6) and per-rule
  fixture/doc existence assertions (AC-9). Positions pinned by printing real
  coordinates on first failure (spec 007/009/010/011 precedent). Update the
  registry-count assertion in `tests/unit/rules/blocking.test.ts`
  (30 → 34).
- **Integration** — extend `tests/integration/scan.test.ts` (the staged-tree
  precedent from spec 011): a tmp project whose `package.json` declares
  `@prisma/client` produces pack diagnostics through the full pipeline with
  `projects[0].frameworks` containing `"prisma"`; the same sources without
  the dependency produce none (AC-6).
- **e2e** — new `tests/e2e/prisma-rules.test.ts` via
  `runCli`/`makeTmpDir`/`expectSuccess` (spec 011 pattern): JSON diagnostics
  from the built bin for a four-violation tree; determinism (two runs
  byte-identical, AC-7); severity override `off`/`error` incl. exit code 1
  (AC-8); jsonl stays diagnostics-only; stdout-only report purity via
  `expectSuccess`; a dependency-free tree yields zero findings (AC-6).
- **Docs** — four rule docs under `docs/rules/backend-doctor/` (AC-9) in the
  existing format (Problem / Bad / Good / Scope notes / Configuration) with
  Prisma-specific bad/good examples. New ts-morph facts discovered while
  probing (tagged-template AST shape, span/leaf walks on template and `+`
  chains) go to `docs/RESEARCH.md` per the deviations discipline.
- **Adapter growth** — `parser/types.ts` grows only type-only re-exports
  (`TemplateExpression`, `TaggedTemplateExpression`, `AwaitExpression`,
  `ForOfStatement`, `ForInStatement`, …) as signatures need them
  (constitution §4); no runtime adapter changes are expected.

## Open questions for review

1. **N+1 trigger breadth.** The PLAN bullet reads "N+1 (`findMany` + query
   in loop)". Recommendation: the trigger is "awaited read query lexically
   inside a loop body" — the loop-per-round-trip is the defect, the outer
   `findMany` may live in another method, and requiring it in the same
   function would miss the helper-function shape while adding coupling;
   vocabulary is reads-only (writes deferred — see Non-goals). Alternative:
   require an outer `findMany` in the same function (literal reading;
   narrower, misses cross-method N+1) and/or include write calls in the
   vocabulary (higher recall, some legitimate dependent-row loops).
2. **Raw-query rule breadth and category.** Recommendation: dynamic text
   only, `*Unsafe` variants flag any non-literal argument while plain
   `$queryRaw`/`$executeRaw` flag only provably-dynamic text (template with
   spans / concat with non-literal); tagged templates and `Prisma.sql` stay
   silent; category Security (the failure mode is SQL injection).
   Alternative: also flag every literal `$queryRawUnsafe` use as a style
   violation (FP-free but noisy — Prisma documents the API as legitimate).
3. **Transaction vocabulary.** Recommendation: awaited bare `fetch`, awaited
   `axios`-rooted member calls, and `setTimeout`/`setInterval` anywhere in
   the callback. Documented recall holes: Nest `HttpService`
   (`this.http.get`), `sleep()`-style user helpers, other HTTP clients, and
   awaited calls in nested non-timer callbacks. Alternative: add any
   awaited member call named `get`/`post`/… on any receiver — rejected
   internally as an FP magnet (`map.get`), but the user may prefer the
   recall.
4. **New dependencies.** Recommendation: none — everything reuses the
   existing traversal vocabulary. Alternative: none identified.
