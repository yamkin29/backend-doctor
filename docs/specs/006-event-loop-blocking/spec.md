# Spec 006 — Event-loop blocking rules (F006)

- **Status:** Implemented (2026-09-19)
- **Phase:** 1 — Node core rules
- **Depends on:** F003 (Engine core) — Done; F004 (Framework detection) — Done
  (pack gate exists; unused by these rules); F005 (Async correctness) — Done
  (statement-level/inside-function-body helpers, module-top-level exemption
  precedent)
- **Blocks:** F007 (security rules reuse the module-import-gate heuristic),
  F019 (runtime attribution will confirm or replace these static heuristics
  with measured blocking)

## Resolution (recorded at approval, 2026-09-19)

The user approved the spec as recommended. All open questions resolved as
recommended: (1) ship the literal-bound CPU-bound loop heuristic; (2) loop
threshold 10,000; (3) module-import gate for the fs/crypto rules; (4) id
`no-cpu-bound-loop`; (5) categories as in the contract table (all
`Performance`); (6) no new dependencies.

## Problem

F005 covered the async-misuse half of Phase 1's latency defects. The other
half is synchronous work that blocks Node's single event loop: `readFileSync`
inside a request handler stalls every concurrent request for the duration of
the I/O, sync key derivation (`pbkdf2Sync`, `scryptSync`) blocks for the full
derivation cost — easily hundreds of milliseconds — and CPU-bound loops
starve the loop for everything queued behind them. These defects are invisible
to the async pack (the code is perfectly synchronous) and invisible in a
single-user dev environment, but they destroy p99 latency in production.
F006 lands three heuristic, warn-by-default rules: sync fs calls, sync crypto,
and a conservative literal-bounded loop heuristic. Static handler attribution
does not exist yet (F008/F013), so "request path" is approximated as "inside
any function body" — module top level stays exempt.

## Goals

- Three rules registered in the product registry (`src/rules/index.ts`), all
  running unconditionally (no `frameworks` gate), all defaulting to `warn`
  (constitution §2) — the first pack in the `Performance` category.
- Heuristic, AST-only detection through the ParserAdapter vocabulary — no
  typechecker, no new dependencies.
- A module-import gate for the two module-API rules (`fs`, `crypto`): a
  file whose module specifiers never reference the module is not scanned by
  that rule — protects the FP budget for objects that merely share method
  names.
- Module top level is exempt in all three rules (crash-fast/block-at-init on
  trusted local input is idiomatic; precedent: spec 005 open question 3).
- One rule doc per rule at `docs/rules/backend-doctor/<id>.md`
  (constitution §3), including explicit Scope notes for every recall hole.
- Determinism (constitution §1) and unchanged contracts: no `schemaVersion`
  bump, no exit-code changes (warn-only defaults keep clean runs at exit 0).

## Non-goals

- Handler/request-path attribution (what function is actually a route
  handler): needs the Nest app model (F008), graph rules (F013) or runtime
  attribution (F019). All three rules here are framework-agnostic.
- Unbounded-loop detection (`while (true)` without escape) — defer; too
  FP-prone without reachability analysis; revisit after the eval corpus
  (F022).
- Weak-crypto detection (`md5`/`sha1`, weak ciphers) — F007 (Security).
- Measured (runtime) blocking attribution — F019.
- Type-aware cost estimation (how expensive one loop iteration is) — no
  numbered feature; would need a PLAN line.
- No new config fields; the existing `rules`/`categories`/`ignore.rules`
  matrix already covers per-rule severities and disables.

## User stories

1. As a backend developer, I run `backend-doctor scan .` on my service and
   get `warn` diagnostics pointing at sync fs calls in functions, sync
   crypto derivation, and literal-bounded CPU-bound loops — each with a
   one-line fix hint (async API, promisified API, or chunked work).
2. As a CI author, the default run stays exit 0 (warn severity); escalating
   any of the three ids to `error` in config flips the run to exit 1; JSON
   and JSONL shapes are unchanged — only new rule ids appear in
   `diagnostics[]`.
3. As an AI agent, I consume `docs/rules/backend-doctor/<id>.md` for each
   new rule and reference findings by their deterministic `id` across runs;
   `jsonl` keeps emitting diagnostics only.

## Contract

### Rule ids, categories, default severities

All ids carry the `backend-doctor/` prefix. All three run unconditionally (no
`frameworks` field). Config keys are the ids below — additive contract
surface.

| id | category | default severity |
|----|----------|------------------|
| `backend-doctor/no-sync-fs-in-request-path` | Performance | `warn` |
| `backend-doctor/no-sync-crypto` | Performance | `warn` |
| `backend-doctor/no-cpu-bound-loop` | Performance | `warn` |

(open questions 1, 4, 5; message texts are fixed in design.md — one message
per rule, like every existing rule.)

### Detection heuristics (precision-first, constitution §2)

**`no-sync-fs-in-request-path`** — flags a CallExpression *inside a function
body* whose callee is one of:

- a PropertyAccessExpression `<recv>.<name>` where `<name>` is a synchronous
  `node:fs` method (the `*Sync` surface: `readFileSync`, `writeFileSync`,
  `existsSync`, `statSync`, `readdirSync`, `mkdirSync`, `unlinkSync`,
  `copyFileSync`, … — exhaustive list pinned in design.md). The receiver is
  not constrained: anything exposing a `*Sync` fs-named method is
  fs-shaped enough to flag, and `fs.promises.*` cannot match (its methods
  are async and not `*Sync`-suffixed);
- a bare Identifier `<name>` from the same set, when the name is bound by a
  same-file declaration (function/variable) — then it is the user's own
  function and is suppressed (shadow check, spec 005 `fetch` precedent).

Gate (open question 3): the file must reference an fs module specifier —
`fs`, `node:fs`, `fs/promises`, `node:fs/promises` — via the existing
`SourceFileView.getModuleSpecifiers()` (static import, `require`, dynamic
`import`). Module top level is exempt. Aliased named imports
(`import { readFileSync as rf }`) are not resolved (documented recall hole).

**`no-sync-crypto`** — flags a CallExpression inside a function body whose
callee is one of `pbkdf2Sync`, `scryptSync`, `generateKeyPairSync`,
`generatePrimeSync`, `hkdfSync`, `randomFillSync` (property form
`crypto.<name>` or bare identifier with the same shadow check). Additionally,
`randomBytes(…)`/`randomFill(…)` are flagged **only in their callback-less
(sync) form**: when a second (callback) argument is passed, the call is async
and not flagged. Gate: the file references `crypto` or `node:crypto`.
Module top level is exempt. Sync-form `crypto.sign`/`crypto.verify` and
`createHash` are not flagged (scope note: cheap or rare enough for v1).

**`no-cpu-bound-loop`** — flags a `for`, `while` or `do…while` statement
inside a function body whose condition is a comparison (`<`, `>`, `<=`,
`>=`, either operand order) against a **numeric literal bound ≥ 10,000**
(open question 2), when the loop body contains no `await` expression (an
awaiting loop yields to the loop). Underscore-separated literals
(`2_000_000`) count after normalization; computed bounds (`2 ** 31`) and
variable bounds are not detected (documented recall hole). The heuristic is
low-recall by design: any static claim about iteration cost is guesswork,
and the literal-bound form is the one shape that is provably ≥ bound
iterations of the body (open question 1).

### Pipeline and unchanged contracts

- Rules are added to `productRules` in `src/rules/index.ts`; `allRules()`
  feeds both `REGISTERED_RULE_IDS` (`src/cli/commands/scan.ts:23`) and the
  runner, so config validation accepts the new ids everywhere automatically
  (mechanism from spec 004 AC-11, reused by spec 005).
- `schemaVersion` stays 1; exit codes stay 0/1/2; report on stdout, errors on
  stderr; jsonl unchanged (diagnostics only). The three rules are
  warn-by-default, so a scan of an offending tree still exits 0 until a user
  escalates.
- Report ordering is the existing `sortDiagnostics` — new diagnostics
  interleave deterministically by file/line/column/rule.
- `parser/types.ts` grows type-only re-exports (`ForStatement`,
  `WhileStatement`, `DoStatement`) per constitution §4 (the adapter grows
  first, rules stay parser-agnostic); no runtime adapter changes expected.

## EARS acceptance criteria

**no-sync-fs-in-request-path**

- **AC-1:** WHEN a function body contains a call whose callee is a property
  access or bare identifier naming a synchronous `node:fs` method (e.g.
  `fs.readFileSync(…)`, bare `readFileSync(…)`) in a file that references an
  fs module specifier, THE SYSTEM SHALL report exactly one diagnostic
  positioned at the start of the call expression.
- **AC-2:** WHEN the sync-fs call occurs at module top level, THE SYSTEM
  SHALL NOT report.
- **AC-3:** WHEN the file references no fs module specifier, or the bare
  identifier is bound by a same-file declaration, or the callee names an
  async fs API (`readFile`, `fs.promises.readFile`), THE SYSTEM SHALL NOT
  report.

**no-sync-crypto**

- **AC-4:** WHEN a function body contains a call to `crypto.pbkdf2Sync`/
  `scryptSync`/`generateKeyPairSync`/`generatePrimeSync`/`hkdfSync`/
  `randomFillSync` (property or bare-identifier form) in a file that
  references a crypto module specifier, THE SYSTEM SHALL report exactly one
  diagnostic at the start of the call.
- **AC-5:** WHEN `randomBytes(…)`/`randomFill(…)` is called without a
  callback argument, THE SYSTEM SHALL report it; WHEN a callback argument is
  passed, THE SYSTEM SHALL NOT report.
- **AC-6:** WHEN the file references no crypto module specifier, or the
  crypto call occurs at module top level, THE SYSTEM SHALL NOT report.

**no-cpu-bound-loop**

- **AC-7:** WHEN a function body contains a `for`/`while`/`do…while` loop
  whose condition compares against a numeric literal of at least 10,000 and
  whose body contains no `await`, THE SYSTEM SHALL report exactly one
  diagnostic positioned at the start of the loop statement.
- **AC-8:** WHEN the literal bound is below 10,000, or the bound is a
  variable or computed expression, or the loop body contains `await`, THE
  SYSTEM SHALL NOT report.

**Registry and pipeline**

- **AC-9:** WHEN `src/rules/index.ts` is imported, THE SYSTEM SHALL have all
  three rules registered with unique ids (ten product rules total).
- **AC-10:** WHEN config sets one of the three ids to `"error"` and a
  matching diagnostic is found, THE SYSTEM SHALL emit it with severity
  `error` and the CLI shall exit 1; WHEN the id is set to `"off"` or listed
  in `ignore.rules`, THE SYSTEM SHALL emit no diagnostic for it.
- **AC-11:** WHEN the same tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports including the new rules' diagnostics.

## Testing strategy (TDD)

- **Fixtures** under `tests/fixtures/backend-doctor/<short-id>/{valid,invalid}/`
  (constitution §3), one finding per invalid file where practical:
  - `no-sync-fs-in-request-path/invalid/`: `property-fs.ts` (fs.readFileSync
    inside a function), `named-import.ts` (bare readFileSync), 
    `require-form.ts` (require + property form);
    `valid/`: `top-level.ts`, `promises-api.ts` (fs.promises / await),
    `own-function.ts` (shadowed name), `no-fs-import.ts`, `async-fs.ts`
    (`readFile`, `appendFile`).
  - `no-sync-crypto/invalid/`: `pbkdf2-sync.ts`, `scrypt-sync.ts` (bare
    named import), `random-bytes-sync.ts`;
    `valid/`: `random-bytes-callback.ts`, `async-kdf.ts` (promisified
    pbkdf2), `no-crypto-import.ts`.
  - `no-cpu-bound-loop/invalid/`: `for-literal.ts`, `while-literal.ts`,
    `do-while-literal.ts`;
    `valid/`: `below-threshold.ts`, `await-in-body.ts`, `variable-bound.ts`,
    `computed-bound.ts`.
  The `bad-app` engine fixture contains no fs calls, crypto calls or loops
  (verified: `tests/fixtures/engine/bad-app/src/`), and the async-rules
  integration/e2e temp trees are likewise clean, so all pinned diagnostic
  arrays stay valid.
- **Unit** `tests/unit/rules/blocking.test.ts` (new) — mirrors
  `async.test.ts`: real `TsMorphParserAdapter`, `runRules` with
  `defaultConfig()` and `detectedFrameworks: []`; invalid fixtures produce
  exact diagnostics (file/line/column/message/severity/category), valid
  fixtures produce `[]`. Covers AC-1..8. A registry assertion in the same
  file (importing `src/rules/index.ts`) covers AC-9.
- **Integration** `tests/integration/scan.test.ts` (extend) — one temp
  project with a sync fs call, a sync KDF and a literal-bounded loop:
  `runScan` returns the three diagnostics in report order with `warn`
  severity, and a config escalation flips the affected diagnostic to `error`
  (AC-10 at the engine level).
- **e2e** `tests/e2e/blocking-rules.test.ts` (new, temp tree via the
  `runCli`/`makeTmpDir` helpers) — json diagnostics contain the new rule ids
  from a real bin run at exit 0; config escalation to `error` flips exit
  code to 1 (AC-10 end to end); two consecutive json scans are
  byte-identical (AC-11).
- **Docs** — one rule doc per rule (constitution §3): Bad/Good examples,
  Scope notes covering every recall hole named in this spec, Configuration
  snippet. Follows the existing docs' format.
- No committed fixtures beyond the per-rule ones; e2e stages temp trees like
  `async-rules.test.ts` does.

## Open questions for review

1. **Ship the CPU-bound loop heuristic at all?** The PLAN line names it
   ("CPU-bound loop heuristics in handlers"), but it is the weakest of the
   three heuristics: variable-bounded loops (the most common real shape) are
   undetectable statically, so recall is low by construction. Recommendation:
   ship the literal-bound heuristic at `warn` — it is the only static shape
   that is provably blocking, it costs nothing to run, and F019 will later
   attribute real blocking at runtime. Alternative: drop it and ship two
   rules, leaving loop detection entirely to F019/F022 — a deliberate
   shrink of the PLAN line, hence this question.
2. **Loop threshold.** Recommendation: numeric literal bound ≥ 10,000 — a
   literal bound that large is almost always deliberate heavy iteration
   (page-size loops are hundreds), and 100,000 would make the rule
   near-dead. Alternative: 100,000 (maximal precision, minimal recall).
3. **Module-import gate for `fs`/`crypto` rules.** Recommendation: flag only
   in files whose module specifiers reference the module (`fs`, `node:fs`,
   `fs/promises`, `node:fs/promises`; `crypto`, `node:crypto`) — using the
   existing `getModuleSpecifiers()`; protects the FP budget when user code
   has same-named members on unrelated objects, and sets the precedent
   F007's module-API rules (child_process, path) will reuse. Alternative:
   flag by callee name alone in any file — simpler, noisier.
4. **Third rule id** (PLAN names the behavior, not the id). Recommendation:
   `backend-doctor/no-cpu-bound-loop`. Alternative:
   `backend-doctor/no-blocking-loop`. The id is a config key — user-owned.
5. **Categories.** Recommendation: all three under `Performance` (first use
   of the category; the defect class is latency, not incorrectness).
   Alternative: all under `Bugs`. Categories are config surface
   (`categories: { Performance: "off" }`), hence user-owned.
6. **New dependencies.** Recommendation: none — all three rules are AST work
   over the existing ts-morph adapter; `parser/types.ts` grows type re-exports
   (`ForStatement`, `WhileStatement`, `DoStatement`) per constitution §4. The
   shared "inside a function body" predicate is reused from
   `src/rules/async/async-calls.ts` (`isInsideFunctionLike`) — a cross-pack
   internal import, no dependency added.
