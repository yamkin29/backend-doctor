# Spec 011 — Rules: errors & lifecycle (F011)

- **Status:** Approved (2026-09-20)
- **Phase:** 2 — Nest specifics & Prisma
- **Depends on:** F008 (Nest app model: providers with className/position) —
  Done; F009/F010 (pack gate, per-file model-query and in-rule AST precedent)
  — Done; F003 (engine core) — Done; F004 (framework detection) — Done
- **Blocks:** F012 (Prisma pack reuses the pack patterns), F022 (eval corpus
  consumes this pack)

## Resolution (recorded at approval, 2026-09-20)

The user approved the spec as recommended ("принято"). All open questions
resolved as recommended: (1) the leak rule keys on `.stack` only — message,
cause and whole error objects are out; (2) comment-only `catch` bodies stay
silent; (3) the heavy-constructor vocabulary is `child_process` calls +
`connect`/`$connect` only — no fs/crypto double-fire with F006; (4) no new
dependencies.

## Problem

Four failure modes from the PLAN line are invisible to the twenty-six shipped
rules: error details (stack traces) leaking to clients through response calls,
`catch` blocks that swallow errors silently, providers that acquire resources
in an init hook but never release them on shutdown, and heavy initialization
(child processes, connection establishment) running in constructors instead of
`onModuleInit`. Each breaks a backend in production long before it breaks a
test: leaked stacks expose internal paths, swallowed errors turn failures into
silent corruption, un-released connections hang graceful shutdown, and
constructor-time initialization races dependency injection. Spec 009
explicitly deferred the "heavy work in constructor" bullet to this feature.
None of the four needs new model data — the existing Nest model plus the file
AST under the established rule patterns covers all of them.

## Goals

- Four new rules, all default `warn` (constitution §2):
  - `backend-doctor/no-empty-catch` (Bugs, **no framework gate**) — a `catch`
    clause whose body holds zero statements and no comment; the error is
    swallowed without a trace. A body with only a comment (documented intent,
    ESLint `no-empty` precedent) stays silent.
  - `backend-doctor/no-error-details-leak` (Security, **no framework gate**) —
    a call to a `json`/`send`/`end`/`write` member whose receiver chain is
    rooted at the identifier `res` or `response`, where any argument contains
    a `.stack` property access. One diagnostic per response call, however many
    stack references it carries.
  - `backend-doctor/missing-on-module-destroy` (Correctness,
    `frameworks: ["nest"]`) — a model provider class declaring `onModuleInit`
    or `onApplicationBootstrap` but none of `onModuleDestroy`,
    `beforeApplicationShutdown`, `onApplicationShutdown`; resources acquired
    at init are never released. One diagnostic at the class position, the
    found init hook named in the message.
  - `backend-doctor/no-heavy-constructor-work` (Correctness,
    `frameworks: ["nest"]`) — inside the constructor body of a model provider
    class: a `child_process` call (`exec`, `execSync`, `execFile`,
    `execFileSync`, `spawn`, `spawnSync`, `fork`; gated on the file referencing
    `child_process`/`node:child_process`) or a `connect`/`$connect` member
    call. One diagnostic per call, message names `onModuleInit` as the target.
- No model, report, or contract changes: the Nest model (spec 008/009/010
  shape) is consumed as-is — lifecycle and constructor facts are read from the
  file AST inside the rules (the `no-business-logic-in-controller` precedent).
  `schemaVersion` stays 1, exit codes stay 0/1/2, no new CLI flags or config
  fields, reporters untouched, no new dependencies.
- Precision gates (constitution §2):
  - `no-empty-catch` is silent on bodies with statements and on comment-only
    bodies; a trailing comment *outside* the braces does not silence it.
  - `no-error-details-leak` keys on `.stack` only — `message`/`cause`/whole
    error objects are not flagged (intentional 4xx messages are idiomatic);
    receivers rooted at other identifiers are not response calls.
  - `missing-on-module-destroy` fires only for `@Injectable` providers in the
    model; controllers and non-Nest classes stay silent.
  - `no-heavy-constructor-work` excludes own-class members (`this.connect()`
    on a class declaring `connect` is user code) and same-file-shadowed bare
    identifiers (the `findModuleApiCalls` protections, reused).
- Complement, not duplication: sync fs/crypto in constructors is already owned
  by F006's rules (a constructor is a function body there) and same-file async
  calls by F005's `no-async-constructor-work`; this pack's vocabulary
  (`child_process`, `connect`) does not overlap either, so no call is reported
  twice.
- Determinism (constitution §1): all findings derive from the file AST, the
  sorted model and fixed constants; two scans are byte-identical.

## Non-goals

- Type-aware analysis (the TS checker): "response object" and "error object"
  recognition stays a naming/shape heuristic — the engine stays syntax-only
  (spec 003).
- Flagging `err.message` / `err.cause` / whole error objects in responses:
  intentional `message` returns (4xx validation errors) are idiomatic; the
  FP surface would be the largest in the codebase. If the eval corpus (F022)
  shows the `.stack`-only recall is too low, extending the content set is a
  later, measured change.
- Empty `finally` blocks and `Promise.catch(() => {})`: PLAN says
  `empty-catch`; other swallow shapes are future work if evals demand them.
- Lifecycle rules for controllers (a controller holding resources is rare;
  only `@Injectable` providers are consulted) and for non-Nest frameworks —
  no lifecycle equivalent ships for Express/Fastify in this feature.
- `new SomeClient()` field initializers in constructors: recognizing "heavy
  client constructors" without types would cry wolf; vocabulary calls only.
- Prisma rules (N+1, raw queries, pagination) — F012. `$connect` appears here
  only as one connection-establishing name.
- Diff scope, runtime attribution of swallowed errors, multi-project/monorepo
  modeling, new dependencies, exit-code/`schemaVersion`/CLI/reporter changes.

## User stories

1. As a backend developer, I run `backend-doctor scan .` and get a warning at
   each `catch` that eats an error, each response that ships a stack trace to
   the client, each provider that opens connections at init without closing
   them at shutdown, and each constructor that spawns processes or dials
   databases before DI finished — each message naming the concrete fix
   (handle or comment, log server-side, add `onModuleDestroy`, move to
   `onModuleInit`), without flagging my deliberate, commented ignores or my
   `res.json({ message })` handlers.
2. As a CI author, the pack behaves like every other pack: `warn` by default
   so exit code stays 0 until I promote rules, `--format json|jsonl`
   unchanged, consecutive runs byte-identical, and a non-Nest repo produces
   none of the lifecycle findings (the two error rules are framework-free by
   design).
3. As an AI agent, I consume the same JSON/JSONL as before — no new schema
   surface — and every finding cites a rule doc at
   `docs/rules/backend-doctor/<rule-id>.md` I can fetch for the bad/good
   examples.

## Contract / Model

No changes to `NestAppModel`, the JSON report, CLI surface, config fields or
exit codes. The only new stable surfaces are the four rule ids below.

### Rules (default severity `warn`)

| Rule id | Category | Gate | Fires at | One diagnostic per |
|---|---|---|---|---|
| `backend-doctor/no-empty-catch` | Bugs | — | the catch clause | empty, comment-free catch body |
| `backend-doctor/no-error-details-leak` | Security | — | the response call | response call carrying `.stack` |
| `backend-doctor/missing-on-module-destroy` | Correctness | `["nest"]` | the class (model position) | provider missing a shutdown hook |
| `backend-doctor/no-heavy-constructor-work` | Correctness | `["nest"]` | the call | heavy call in a provider constructor |

Per-rule semantics:

- **no-empty-catch** — traverse the file for `CatchClause` nodes; report when
  the body block holds zero statements and its full text stripped of braces
  and whitespace is empty (no comment). Bodies with statements are silent;
  comment-only bodies are silent (documented intent); a comment after the
  closing brace does not count.
- **no-error-details-leak** — traverse for calls whose callee is a
  `PropertyAccessExpression` named `json`, `send`, `end` or `write` whose
  receiver chain unwraps (through calls/parens, `isRequestRootedChain`-style)
  to the identifier `res` or `response` (the `REQUEST_ROOTS` symmetry from
  spec 007). When any argument's subtree contains a property access named
  `stack`, report once at the call. Bare `res`/`response` calls are not
  considered (method-name gate); non-rooted chains are not.
- **missing-on-module-destroy** — for model providers with
  `filePath === ctx.file.filePath`, locate the `ClassDeclaration` by name in
  the file AST and inspect its instance methods. Init hooks: `onModuleInit`,
  `onApplicationBootstrap`. Shutdown hooks (any one satisfies):
  `onModuleDestroy`, `beforeApplicationShutdown`, `onApplicationShutdown`.
  Report at the provider's stored class position when an init hook is present
  and no shutdown hook is. Static methods are ignored; method-name matching
  covers both `implements OnModuleInit` and bare declarations.
- **no-heavy-constructor-work** — collect candidates via
  `findModuleApiCalls` twice: (a) specifiers `["child_process",
  "node:child_process"]`, names `exec`, `execSync`, `execFile`, `execFileSync`,
  `spawn`, `spawnSync`, `fork`; (b) no specifiers, names `connect`,
  `$connect`. Keep a candidate only when its nearest function-like ancestor is
  a `ConstructorDeclaration` whose class is a model provider in the scanned
  file. The `findModuleApiCalls` own-class-member and same-file-shadow
  protections apply unchanged.

Message templates (exact strings, snapshot-pinned):

- `no-empty-catch`: `This catch block is empty: the error disappears without a
  trace. Handle it, rethrow it, or write the reason for the deliberate ignore
  as a comment inside the block.`
- `no-error-details-leak`: `A stack trace reaches the client through this
  response; stacks expose file paths and internal structure. Log the error
  server-side and return a generic message or a safe error payload instead.`
- `missing-on-module-destroy`: `<Class> initializes in <hook> but declares no
  shutdown hook; resources acquired there are never released. Add
  onModuleDestroy (or beforeApplicationShutdown / onApplicationShutdown) to
  release them.` — `<hook>` is the found init hook (`onModuleInit` wins over
  `onApplicationBootstrap` when both are present).
- `no-heavy-constructor-work`: `<name> runs in the constructor of <Class>;
  heavy initialization runs before DI completes and hides failures from the
  lifecycle. Move it into onModuleInit so it starts after dependencies are
  resolved and can be awaited.` — `<name>` is the matched callee name
  (`exec`, `connect`, `$connect`, …).

## EARS acceptance criteria

- **AC-1:** WHEN a `catch` clause body in the scanned file holds zero
  statements and contains no comment, THE SYSTEM SHALL report exactly one
  `no-empty-catch` diagnostic (warn, Bugs) at the catch clause position; WHEN
  the body holds at least one statement or contains only a comment, THE
  SYSTEM SHALL NOT report.
- **AC-2:** WHEN a call to a `json`/`send`/`end`/`write` member rooted at
  `res` or `response` has an argument whose subtree contains a `.stack`
  property access, THE SYSTEM SHALL report exactly one
  `no-error-details-leak` diagnostic (warn, Security) at the call — once per
  call regardless of the number of stack references; WHEN the receiver is
  rooted at any other identifier, the method is none of the four, or no
  argument references `.stack`, THE SYSTEM SHALL NOT report.
- **AC-3:** WHEN a model provider class defined in the scanned file declares
  `onModuleInit` or `onApplicationBootstrap` and declares none of
  `onModuleDestroy`/`beforeApplicationShutdown`/`onApplicationShutdown`,
  THE SYSTEM SHALL report exactly one `missing-on-module-destroy` diagnostic
  (warn, Correctness) at the class position with the init hook named; WHEN a
  shutdown hook is declared, no init hook is declared, or the class is not a
  model provider (controller, plain class), THE SYSTEM SHALL NOT report.
- **AC-4:** WHEN a `child_process` `exec*`/`spawn*`/`fork` call (file
  references the module) or a `connect`/`$connect` member call sits inside the
  constructor body of a model provider class, THE SYSTEM SHALL report exactly
  one `no-heavy-constructor-work` diagnostic (warn, Correctness) at the call;
  WHEN the same call sits outside a constructor, in a controller or
  non-provider class, is an own-class member call, or is a bare identifier
  shadowed by a same-file binding, THE SYSTEM SHALL NOT report.
- **AC-5:** WHEN the scanned file contains none of the pack's triggers (no
  empty catch, no stack-carrying response call, no qualifying provider or
  constructor), THE SYSTEM SHALL produce no diagnostics from this pack for
  that file.
- **AC-6:** WHEN nest is not among the detected frameworks or the model is
  absent, THE SYSTEM SHALL produce no `missing-on-module-destroy` or
  `no-heavy-constructor-work` diagnostics while `no-empty-catch` and
  `no-error-details-leak` continue to run, with unchanged exit codes.
- **AC-7:** WHEN the same tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports.
- **AC-8:** WHEN config sets a pack rule to `"off"` THE SYSTEM SHALL produce
  no diagnostics for it, and WHEN set to `"error"` THE SYSTEM SHALL escalate
  its severity (exit code 1 when such diagnostics exist).
- **AC-9:** WHEN the feature ships, every pack rule SHALL have `valid/` and
  `invalid/` fixtures, snapshot tests of the exact diagnostics, and a markdown
  doc at `docs/rules/<rule-id>.md` (constitution §3).

## Testing strategy (TDD)

- **Fixtures.** The two node-core rules follow the flat convention; the two
  Nest rules follow the pack convention (spec 010 precedent — Nest rules need
  module/controller/provider context):
  - `tests/fixtures/backend-doctor/no-empty-catch/{valid,invalid}/` — invalid:
    a bare `catch {}` and a `catch (e) {}` with a trailing comment outside the
    braces; valid: a handling catch, a rethrow, a comment-only body (AC-1).
  - `tests/fixtures/backend-doctor/no-error-details-leak/{valid,invalid}/` —
    invalid: Express-style `res.status(500).json({ stack: err.stack })` and a
    Nest-filter-style `response.status(...).json({ ..., stack:
    exception.stack })`; valid: `res.json({ message: err.message })`, a
    `logger.error(err.stack)` call (not a response), a stack-free response
    (AC-2).
  - `tests/fixtures/nest/errors-lifecycle/lifecycle-hooks/{valid,invalid}/` —
    multi-file mini-apps (module + providers): invalid — a provider with
    `onModuleInit` and none of the shutdown hooks, a provider with
    `onApplicationBootstrap` only; valid — a provider with
    `onModuleInit` + `onModuleDestroy`, one with
    `beforeApplicationShutdown` only, a controller with `onModuleInit`
    (providers-only scope), a provider with neither hook (AC-3).
  - `tests/fixtures/nest/errors-lifecycle/heavy-constructor/{valid,invalid}/`
    — invalid: a provider constructor calling `execSync`, one calling
    `this.client.$connect()`, one calling a bare `connect()`; valid — the same
    calls inside `onModuleInit`, a class with its own `connect` method called
    as `this.connect()`, calls in a non-constructor method, a controller
    constructor with the same calls (providers-only scope) (AC-4).
- **Unit** — new `tests/unit/rules/errors-lifecycle.test.ts`: the flat-fixture
  pattern from `tests/unit/rules/security.test.ts` (`scanFixture` +
  `rulesById`) for AC-1/AC-2; the `scanNestFixture` pattern from
  `tests/unit/rules/layers-dto.test.ts` (real adapter, `extractNestAppModel`,
  `runRules`, `detectedFrameworks: ["nest"]`) for AC-3/AC-4. Exact diagnostics
  (file, line, column, message, severity, category); positions pinned by
  printing real coordinates on first failure (spec 007/009/010 precedent).
  Update the registry-count assertion in `tests/unit/rules/blocking.test.ts`
  (26 → 30).
- **Integration** — extend `tests/integration/scan.test.ts` (the spec 005
  `runScan` precedent): a staged Nest tree produces pack diagnostics through
  the full pipeline; a non-nest tree produces no lifecycle-rule findings while
  the framework-free rules still fire (AC-6).
- **e2e** — new `tests/e2e/errors-lifecycle-rules.test.ts` via
  `runCli`/`makeTmpDir`/`expectSuccess`: JSON diagnostics from the built bin
  for a leak + empty-catch tree and a lifecycle tree; determinism (two runs
  byte-identical, AC-7); severity override `off`/`error` incl. exit code 1
  (AC-8); jsonl stays diagnostics-only; stdout-only report purity via
  `expectSuccess`.
- **Docs** — four rule docs under `docs/rules/backend-doctor/` (AC-9), in the
  existing format (Problem / Bad / Good / Scope notes / Configuration); unit
  assertions check each shipped rule's `docs` path exists on disk. New
  ts-morph facts discovered while probing (`CatchClause` surface, comment
  detection via full text) go to `docs/RESEARCH.md` per the deviations
  discipline.
- **Adapter growth** — `parser/types.ts` grows only type-only re-exports
  (`CatchClause`, plus `Block` if the implementation needs to name it) per the
  established precedent (constitution §4); no runtime adapter changes are
  expected.

## Open questions for review

1. **Leak content scope: `.stack` only?** Recommendation: yes — `.stack` in a
   response argument is a leak with near-zero FP surface and covers both the
   Express and the Nest-filter idiom; extending to `message`/whole error
   objects would flag the idiomatic `res.json({ message: err.message })`
   validation-error shape. Alternative: flag whole error identifiers too
   (`res.json(err)`) — higher recall, but requires binding tracking the
   syntax-only engine does not have, so it would degenerate to name matching
   (`err`/`error`/`e`).
2. **Comment-only `catch` bodies.** Recommendation: silent (documented
   intent; the ESLint `no-empty` precedent — that rule also ignores blocks
   containing a comment). Alternative: flag them too (max recall, but cries
   wolf on every deliberate `catch { /* cache miss is fine */ }`).
3. **Heavy-constructor vocabulary.** Recommendation: `child_process`
   calls + `connect`/`$connect` only. Sync fs/crypto in constructors is
   already reported by F006's rules (a constructor is a function body there),
   and same-file async calls by F005's `no-async-constructor-work`; adding
   fs/crypto here would double-fire the same call with two different advice
   messages. Alternative: include fs/crypto and accept the double-fire for
   the stronger "move to onModuleInit" framing.
4. **New dependencies.** Recommendation: none — everything reuses the existing
   traversal vocabulary (`findModuleApiCalls`, model entries). Alternative:
   none identified.
