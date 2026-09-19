# Spec 005 — Async-correctness rules (F005)

- **Status:** Draft — pending review
- **Phase:** 1 — Node core rules
- **Depends on:** F003 (Engine core) — Done; F004 (Framework detection) — Done
  (the pack gate exists; none of these rules declare frameworks)
- **Blocks:** F006 (event-loop blocking reuses the statement-level call
  heuristics), F011 (Nest lifecycle rules reuse the constructor-work detection)

## Problem

The engine ships exactly two rules (`no-eval`, `no-new-func`, both Security).
The highest-frequency real-world backend defects are async-misuse defects:
fire-and-forget promises whose rejections vanish, `Array.forEach(async …)`
that silently breaks sequencing, `JSON.parse` throws that turn a malformed
request into a 500, constructors racing with their own initialization, and
`EventEmitter` `'error'` emissions that crash the Node process. F005 lands the
first Node-core rule pack — five heuristic rules at `warn` severity — and the
first shared async-call heuristics built on the parser-adapter vocabulary.
Type-aware floating-promise analysis stays out (PLAN: "type-aware later").

## Goals

- Five rules registered in the product registry
  (`src/rules/index.ts`), all running unconditionally (no `frameworks` gate),
  all defaulting to `warn` (constitution §2).
- Heuristic, AST-only detection through the ParserAdapter vocabulary — no
  typechecker, no new dependencies.
- A shared same-file async-callee resolution helper used by
  `no-floating-promises` and `no-async-constructor-work` (one heuristic, two
  scopes).
- The `void` operator is the documented escape hatch for intentional
  fire-and-forget (typescript-eslint convention).
- One rule doc per rule at `docs/rules/backend-doctor/<id>.md`
  (constitution §3), including explicit Scope notes for every recall hole.
- Determinism (constitution §1) and unchanged contracts: no `schemaVersion`
  bump, no exit-code changes (warn-only defaults keep clean runs at exit 0).

## Non-goals

- Type-aware analysis (tsconfig/typechecker) — not owned by a numbered
  feature; would need a new PLAN line.
- Cross-file / call-graph tracking (imported async functions, aliased
  promises, emitters passed as parameters) — graph rules land in F013.
- Nest-specific lifecycle rules (`onModuleInit` advice, DI constructor
  blocking) — F009/F011. The generic constructor rule here is
  framework-agnostic.
- Event-loop sync blocking (`readFileSync` in request paths, `no-sync-crypto`)
  — F006.
- Runtime unhandled-rejection detection — Phase 5 (F018+).
- No new config fields; the existing `rules`/`categories`/`ignore.rules`
  matrix already covers per-rule severities and disables.

## User stories

1. As a backend developer, I run `backend-doctor scan .` on my service and get
   `warn` diagnostics that point at fire-and-forget async calls, async
   `forEach` callbacks, unguarded `JSON.parse`, async work in constructors,
   and `'error'` emissions without a listener — each with a one-line fix hint.
2. As a CI author, the default run stays exit 0 (warn severity); escalating
   any of the five ids to `error` in config flips the run to exit 1; JSON and
   JSONL shapes are unchanged — only new rule ids appear in `diagnostics[]`.
3. As an AI agent, I consume `docs/rules/backend-doctor/<id>.md` for each new
   rule and reference findings by their deterministic `id` across runs;
   `jsonl` keeps emitting diagnostics only.

## Contract

### Rule ids, categories, default severities

All ids carry the `backend-doctor/` prefix. All five run unconditionally (no
`frameworks` field). Config keys are the ids below — additive contract surface.

| id | category | default severity |
|----|----------|------------------|
| `backend-doctor/no-floating-promises` | Correctness | `warn` |
| `backend-doctor/no-async-foreach-callback` | Bugs | `warn` |
| `backend-doctor/unhandled-json-parse` | Bugs | `warn` |
| `backend-doctor/no-async-constructor-work` | Correctness | `warn` |
| `backend-doctor/no-unhandled-emitter-error` | Bugs | `warn` |

(open questions 5–6; message texts are fixed in design.md — one message per
rule, like `no-eval`.)

### Detection heuristics (precision-first, constitution §2)

**`no-floating-promises`** — flags a *statement-level call* (a CallExpression
that, after unwrapping parentheses, is the entire expression of an
ExpressionStatement) when its callee is one of:

- an Identifier bound in the same file to an `async` function declaration or
  an async arrow / function expression assigned to a variable;
- the identifier `fetch` (known promise-returning global; a same-file
  declaration of `fetch` shadows it and suppresses the finding);
- a PropertyAccessExpression `this.<name>` where the enclosing class declares
  an `async` method `<name>`.

Suppressed (no finding): `await`-prefixed, `void`-prefixed (open question 2),
result assigned / returned / yielded (the statement expression is then not a
bare call), and constructor bodies — those belong to
`no-async-constructor-work` (open question 4). Chains like
`load().then(cb)` are not flagged in v1: the callee is a property access named
`then`, outside the three matched forms (open question 1; documented as a
Scope note, not silently lost).

**`no-async-foreach-callback`** — flags a CallExpression whose callee is a
PropertyAccessExpression named `forEach` (any receiver — no type info) whose
first argument is an inline async arrow or async function expression. Not
flagged: sync callbacks, `map`/`filter` with async callbacks (the Promise.all
pattern), `for…of` with `await`, and callbacks referenced by identifier
(documented recall hole).

**`unhandled-json-parse`** — flags a CallExpression `JSON.parse(…)` (receiver
text exactly `JSON`, method `parse`) that appears lexically inside a function
body with no ancestor TryStatement carrying a catch clause. Module top-level
`JSON.parse` is exempt: init-time crash-fast on trusted local config is
idiomatic; the rule targets the request path (open question 3). Callers that
catch upstream of a helper are not tracked (no call graph — documented).

**`no-async-constructor-work`** — flags the same statement-level async-call
forms as `no-floating-promises` (same-file async identifier, `this.<name>()`
on an async method, and `fetch`), restricted to ConstructorDeclaration bodies.
`void`-prefixed calls are suppressed. The message steers toward an explicit
initialization step callers can await (Nest's `onModuleInit` is mentioned in
the rule doc, not in the message — the rule is framework-agnostic).

**`no-unhandled-emitter-error`** — Node throws an uncaught exception when an
`EventEmitter` emits `'error'` with no listener. The rule tracks receivers
initialized from `new EventEmitter()` (callee text `EventEmitter`):

- a local `const`/`let` variable (receiver key = variable name), or
- a class property initialized inline (receiver key = `this.<name>`).

It reports one diagnostic at the `.emit(…)` call when a tracked receiver key
emits the string-literal event `"error"` and no error-listener registration
exists for that key: `.on("error"`, `.once("error"`, `.addListener("error")`,
`.prependListener("error")` — first argument must be the string literal
`"error"`. Non-literal event names, subclass instances (`new MyEmitter()`),
`events.EventEmitter` property form, and receivers used across function
boundaries are not tracked (documented recall holes; precision-first).

### Pipeline and unchanged contracts

- Rules are added to `productRules` in `src/rules/index.ts`; `allRules()`
  feeds both `REGISTERED_RULE_IDS` (`src/cli/commands/scan.ts:23`) and the
  runner, so config validation accepts the new ids everywhere automatically
  (mechanism from spec 004 AC-11).
- `schemaVersion` stays 1; exit codes stay 0/1/2; report on stdout, errors on
  stderr; jsonl unchanged (diagnostics only). The five rules are warn-by-
  default, so a scan of an offending tree still exits 0 until a user escalates.
- Report ordering is the existing `sortDiagnostics` — new diagnostics
  interleave deterministically by file/line/column/rule.

## EARS acceptance criteria

**no-floating-promises**

- **AC-1:** WHEN a statement-level call targets a same-file async function
  declaration or an async arrow/function expression assigned to a variable,
  THE SYSTEM SHALL report exactly one diagnostic positioned at the start of
  the call expression.
- **AC-2:** WHEN a statement-level call is `fetch(…)`, THE SYSTEM SHALL report
  it under AC-1's message and position rules.
- **AC-3:** WHEN a statement-level `this.<name>()` call targets an `async`
  method of the enclosing class, THE SYSTEM SHALL report it.
- **AC-4:** WHEN the call is awaited, `void`-prefixed, chained with
  `.then`/`.catch`/`.finally`, or its result is assigned, returned or yielded,
  THE SYSTEM SHALL NOT report.
- **AC-5:** WHEN the callee identifier is shadowed by a same-file non-async
  declaration, THE SYSTEM SHALL NOT report.
- **AC-6:** WHEN the statement-level async call sits inside a constructor
  body, `no-floating-promises` SHALL NOT report it (open question 4).

**no-async-foreach-callback**

- **AC-7:** WHEN `X.forEach(…)` receives an inline async arrow or async
  function expression as its first argument, THE SYSTEM SHALL report exactly
  one diagnostic at the start of the `forEach` call.
- **AC-8:** WHEN `forEach` receives a sync callback, or async callbacks are
  passed to `.map` (Promise.all pattern), or iteration uses `for…of` with
  `await`, THE SYSTEM SHALL NOT report.

**unhandled-json-parse**

- **AC-9:** WHEN a `JSON.parse(…)` call occurs inside a function body with no
  ancestor try statement carrying a catch clause, THE SYSTEM SHALL report
  exactly one diagnostic at the start of the call.
- **AC-10:** WHEN `JSON.parse` is enclosed by a try statement with a catch
  clause or occurs at module top level, THE SYSTEM SHALL NOT report.

**no-async-constructor-work**

- **AC-11:** WHEN a constructor body contains a statement-level call to a
  same-file async function/variable, `this.<asyncMethod>()`, or `fetch(…)`,
  THE SYSTEM SHALL report exactly one diagnostic at the start of the call.
- **AC-12:** WHEN the constructor call is `void`-prefixed, chained, or the
  constructor only performs synchronous work, THE SYSTEM SHALL NOT report.

**no-unhandled-emitter-error**

- **AC-13:** WHEN a receiver initialized from `new EventEmitter()` calls
  `.emit("error", …)` and no error-listener registration exists for that
  receiver key in the same file, THE SYSTEM SHALL report exactly one
  diagnostic at the start of the `emit` call.
- **AC-14:** WHEN an error listener (`.on`/`.once`/`.addListener`/
  `.prependListener` with the literal `"error"`) is registered for the
  receiver, or only non-`"error"` events are emitted, THE SYSTEM SHALL NOT
  report.
- **AC-15:** WHEN an emitter receiver is passed to another function, aliased,
  or constructed as a subclass instance, THE SYSTEM SHALL NOT report.

**Registry and pipeline**

- **AC-16:** WHEN `src/rules/index.ts` is imported, THE SYSTEM SHALL have all
  five rules registered with unique ids (seven product rules total).
- **AC-17:** WHEN config sets one of the five ids to `"error"` and a matching
  diagnostic is found, THE SYSTEM SHALL emit it with severity `error` and the
  CLI shall exit 1; WHEN the id is set to `"off"` or listed in
  `ignore.rules`, THE SYSTEM SHALL emit no diagnostic for it.
- **AC-18:** WHEN the same tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports including the new rules' diagnostics.

## Testing strategy (TDD)

- **Fixtures** under `tests/fixtures/backend-doctor/<short-id>/{valid,invalid}/`
  (constitution §3), one finding per invalid file where practical:
  - `no-floating-promises/invalid/`: `async-fn.ts`, `async-arrow.ts`,
    `this-method.ts`, `fetch.ts`;
    `valid/`: `awaited.ts`, `void-prefixed.ts`, `chained.ts`, `assigned.ts`,
    `returned.ts`, `shadowed.ts`, `constructor-owned.ts`.
  - `no-async-foreach-callback/invalid/`: `async-arrow.ts`,
    `async-function.ts`; `valid/`: `sync-callback.ts`, `map-promise-all.ts`,
    `for-of-await.ts`.
  - `unhandled-json-parse/invalid/`: `in-function.ts`; `valid/`:
    `try-catch.ts`, `module-top-level.ts`.
  - `no-async-constructor-work/invalid/`: `this-method.ts`, `helper-fn.ts`;
    `valid/`: `void-init.ts`, `sync-only.ts`.
  - `no-unhandled-emitter-error/invalid/`: `emit-no-listener.ts`,
    `this-emitter.ts`; `valid/`: `with-listener.ts`, `other-event.ts`,
    `passed-to-function.ts`.
  The `bad-app` engine fixture contains no async constructs, `JSON.parse` or
  emitters (verified: `tests/fixtures/engine/bad-app/src/`), so the pinned
  integration/e2e diagnostic arrays stay valid.
- **Unit** `tests/unit/rules/async.test.ts` (new) — mirrors
  `security.test.ts`: real `TsMorphParserAdapter`, `runRules` with
  `defaultConfig()` and `detectedFrameworks: []`; invalid fixtures produce
  exact diagnostics (file/line/column/message/severity/category), valid
  fixtures produce `[]`. Covers AC-1..15. A registry assertion in the same
  file (importing `src/rules/index.ts`) covers AC-16.
- **Integration** `tests/integration/scan.test.ts` (extend) — one temp project
  with a floating promise, an async `forEach` and an unguarded `JSON.parse`:
  `runScan` returns the three diagnostics in report order with `warn`
  severity, and a config escalation flips the affected diagnostic to `error`
  (AC-17 at the engine level).
- **e2e** `tests/e2e/async-rules.test.ts` (new, temp tree via the
  `runCli`/`makeTmpDir` helpers) — json diagnostics contain the new rule ids
  from a real bin run; config escalation to `error` flips exit code to 1
  (AC-17 end to end); two consecutive json scans are byte-identical (AC-18).
- No committed fixtures beyond the per-rule ones; e2e stages temp trees like
  `framework.test.ts` does.

## Open questions for review

1. **`no-floating-promises` v1 scope.** Recommendation: the minimal set in the
   Contract — same-file async identifier calls, `this.<asyncMethod>()`,
   `fetch()`. Chains (`.then`/`.finally` without `.catch`), cross-file calls,
   object-literal methods and assigned-then-floating promises are out of scope
   and listed in the rule doc's Scope notes. Alternative: also flag
   statement-level `.then(...)` chains lacking `.catch` (typescript-eslint
   does flag them) — more recall, but without types it risks flagging
   non-promise thenables and needs chain-walking; propose revisiting after
   the F022 eval corpus.
2. **`void` as the documented suppression.** Recommendation: yes — statements
   prefixed with the `void` operator are never flagged by
   `no-floating-promises` or `no-async-constructor-work` (typescript-eslint
   convention; gives an inline, reviewable escape hatch and protects the
   precision budget). Alternative: no suppression — users would have to
   silence whole files via `ignore`.
3. **`unhandled-json-parse` top-level exemption.** Recommendation: exempt
   module top level (crash-fast init parsing of trusted local files is
   idiomatic), flag inside function bodies without try/catch (request-path
   focus). Alternative: flag every unguarded `JSON.parse` regardless of
   nesting — noticeably noisier on real codebases.
4. **Constructor dedup.** Recommendation: constructor bodies are owned
   exclusively by `no-async-constructor-work`; `no-floating-promises` skips
   them, so one violation produces one diagnostic. Alternative: both rules
   fire (double findings for the same construct).
5. **Fifth rule id** (PLAN names the behavior, not the id). Recommendation:
   `backend-doctor/no-unhandled-emitter-error`. Alternative:
   `backend-doctor/emitter-error-no-listener`. The id is a config key —
   user-owned.
6. **Categories.** Recommendation: `no-floating-promises` → Correctness,
   `no-async-constructor-work` → Correctness (async-contract violations);
   `no-async-foreach-callback` → Bugs, `unhandled-json-parse` → Bugs,
   `no-unhandled-emitter-error` → Bugs (crash-or-misbehave defects).
   Alternative: all five under Correctness. Categories are config surface
   (`categories: { Bugs: "off" }`), hence user-owned.
7. **Known-async globals.** Recommendation: `fetch` only in v1 — everything
   else (`fs/promises` wrappers, axios, nodemailer, …) is a property access we
   cannot resolve without cross-file/type info, and guessing receiver names
   would burn the FP budget. Alternative: add a small allowlist of
   common property-call names (`.save()`, `.send()`, …) — rejected here as
   guesswork.
8. **New dependencies.** Recommendation: none — all five rules are AST work
   over the existing ts-morph adapter; `parser/types.ts` grows re-exports
   (`ArrowFunction`, `FunctionDeclaration`, `ClassDeclaration`,
   `TryStatement`, `ConstructorDeclaration`, …) per constitution §4 (the
   adapter grows first, rules stay parser-agnostic). No other deps.
