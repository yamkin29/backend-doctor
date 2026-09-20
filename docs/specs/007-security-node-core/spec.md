# Spec 007 — Security rules, Node core (F007)

- **Status:** Draft — pending review
- **Phase:** 1 — Node core rules
- **Depends on:** F003 (Engine core) — Done (`defineRule`, runner, registry);
  F004 (Framework detection) — Done (pack gate exists; unused by these rules);
  F005 (Async correctness) — Done (fetch shadow-check precedent);
  F006 (Event-loop blocking) — Done (module-import gate, shadow checks,
  `findSyncModuleCalls` collector anticipated F007's module-API rules)
- **Blocks:** F008/F013 (real handler attribution will tighten the request-input
  heuristic), F017 (rule docs for agents), F022 (eval corpus proves the FP budget)

## Problem

The registry ships ten rules but only two are Security (`no-eval`, `no-new-func`,
both from spec 003). The defect class PLAN assigns to F007 — command injection,
path traversal, hardcoded secrets, weak hashes, SSRF, prototype pollution — is
the one with direct exploit paths, and none of it is covered. These defects are
invisible to the async and blocking packs (the code usually "works"), so nothing
points at them today. F007 lands the remaining Phase 1 security batch: six
heuristic, warn-by-default, framework-agnostic rules. Real taint tracking does
not exist yet (no Nest app model, no import graph), so "user input" is
approximated by the near-universal `req`/`request` parameter naming, and every
recall hole is documented in the rule docs.

## Goals

- Six rules registered in the product registry (`src/rules/index.ts`), all
  running unconditionally (no `frameworks` gate), all defaulting to `warn`
  (constitution §2) — the `Security` category grows from two to eight rules.
- Heuristic, AST-only detection through the ParserAdapter vocabulary — no
  typechecker, no new dependencies.
- One shared request-input heuristic: a property-access chain rooted at the
  identifier `req` or `request` (exact, case-sensitive), matched directly,
  through parentheses, template substitutions, or `+` concatenation operands —
  one implementation, consumed by three rules.
- The spec 006 module-gate precedent (module specifier check + callee-name
  match + shadow/own-member checks) is reused for the module-API rules
  (`child_process`, `path`, `crypto`, `axios`); the "inside a function body"
  restriction of F006 is NOT carried over — a security defect is one at module
  top level too.
- Deterministic secret detection: a pinned secret-name list plus string length
  and Shannon-entropy thresholds — pure arithmetic, byte-identical runs
  (constitution §1).
- One rule doc per rule at `docs/rules/backend-doctor/<id>.md`
  (constitution §3), including explicit Scope notes for every recall hole.
- Unchanged contracts: no `schemaVersion` bump, no exit-code changes (warn-only
  defaults keep clean runs at exit 0).

## Non-goals

- Real taint tracking (dataflow across files, custom request-parameter names,
  values stored then used) — needs the Nest app model (F008), graph rules
  (F013) or the runtime engine (F018+). The `req`/`request` root is the v1
  approximation and its limits are documented.
- `no-eval` / `no-new-func` — already shipped in spec 003; this feature adds
  nothing to them.
- SQL/NoSQL injection — a different defect class with no PLAN line; would need
  its own roadmap entry (worth proposing after F022).
- Secrets in non-string positions (files, base64 blobs, split strings) and
  detection beyond declarations (assignment to an existing variable) — recall
  holes documented in the rule doc, revisit after F022.
- Crypto strength beyond the hash-algorithm literal (key lengths, ciphers,
  timing-safe comparison) — no PLAN line; documented as a hole.
- Insecure-dependency auditing (`npm audit` territory) — out of scope for a
  static AST analyzer.
- Nest-specific security (missing `ValidationPipe`, DTO exposure) — F010.
- No new config fields; the existing `rules`/`categories`/`ignore.rules`
  matrix already covers per-rule severities and disables.

## User stories

1. As a backend developer, I run `backend-doctor scan .` and get `warn`
   diagnostics pointing at dynamic shell execs, request-derived `path.join`
   arguments, long high-entropy literals under secret-shaped names, `md5`/`sha1`
   hash calls, `fetch(…)` of request-derived URLs, and merges of request bodies
   into objects — each with a one-line fix hint (argument arrays, `path.basename`,
   env vars, SHA-256, allowlisted hosts, prototype-safe merge).
2. As a CI author, the default run stays exit 0 (warn severity); escalating any
   of the six ids to `error` in config flips the run to exit 1; JSON and JSONL
   shapes are unchanged — only new rule ids appear in `diagnostics[]`.
3. As an AI agent, I consume `docs/rules/backend-doctor/<id>.md` for each new
   rule and reference findings by their deterministic `id` across runs; `jsonl`
   keeps emitting diagnostics only.

## Contract

### Rule ids, categories, default severities

All ids carry the `backend-doctor/` prefix. All six run unconditionally (no
`frameworks` field). Config keys are the ids below — additive contract surface.

| id | category | default severity |
|----|----------|------------------|
| `backend-doctor/no-command-injection` | Security | `warn` |
| `backend-doctor/no-path-traversal` | Security | `warn` |
| `backend-doctor/no-hardcoded-secrets` | Security | `warn` |
| `backend-doctor/no-weak-crypto` | Security | `warn` |
| `backend-doctor/no-ssrf` | Security | `warn` |
| `backend-doctor/no-unsafe-merge` | Security | `warn` |

(open questions 1–2; message texts are fixed in design.md — one message per
rule, like every existing rule.)

### Shared request-input heuristic

An expression **contains request input** when, unwrapping parentheses, it is a
property-access chain whose root identifier is exactly `req` or `request`
(`req.params.filename`, `request.body.url`), or it is a template literal / `+`
concatenation with such a chain in any substitution or operand. Element access
(`req["params"]`), other root names (`ctx`, `c`), and req passed whole are not
matched (documented recall holes). Consumed by `no-path-traversal`,
`no-ssrf`, and `no-unsafe-merge`.

### Detection heuristics (precision-first, constitution §2)

**`no-command-injection`** — gate: the file references `child_process` or
`node:child_process`. Flags a CallExpression whose callee is a
PropertyAccessExpression named `exec` or `execSync` (receiver unconstrained —
the spec 006 precedent) or a bare identifier with that name not bound by a
same-file declaration or the enclosing class (`exec` from a named import), when
the first argument exists and is not a string literal: template with
substitutions, `+` concatenation, identifier, call result. A spread-only
argument list is indistinguishable from the dynamic form and is flagged
(documented recall hole, spec 006 precedent). `spawn`/`execFile`/`fork` are not
flagged — they do not invoke a shell by default; the message steers to them as
the fix. Unlike the F006 rules there is **no module-top-level exemption**: a
dynamic shell command is an injection risk wherever it runs.

**`no-path-traversal`** — gate: the file references `path` or `node:path`.
Flags a CallExpression `path.join(…)` / `path.resolve(…)` — property form with
the receiver being exactly the identifier `path`, or bare `join`/`resolve` not
shadowed by a same-file binding — when any argument contains request input.
The receiver is constrained here (unlike F006) because `join`/`resolve` are
common collection-method names (`arr.join(…)`); anything but a literal
`path` receiver is treated as user code. Aliased default imports
(`import pa from "node:path"`) and `require("path").join(…)` are not matched
(documented recall holes).

**`no-hardcoded-secrets`** — no module gate (a secret has no import). Flags a
variable declaration, class property declaration, or object-literal property
assignment whose name, normalized (lowercased, `_`/`-`/`$`/spaces removed),
*contains* one of the pinned secret names (compound forms only: `password`,
`passwd`, `apikey`, `apisecret`, `secretkey`, `accesskey`, `secretaccesskey`,
`authtoken`, `accesstoken`, `refreshtoken`, `clientsecret`, `privatekey`,
`appsecret`, `encryptionkey`, `signingkey`, `sessionsecret`, `webhooksecret`,
`dbpassword`, `dbpass`, `awssecretaccesskey` — bare `secret`, `token`, `key`,
`credentials` are excluded as too ambiguous), when the initializer is a string
literal of length ≥ 16 with Shannon entropy ≥ 3.0 bits. Non-literal
initializers (`process.env.X` — the fix anyway), short literals, low-entropy
repetitive literals, and ambiguous names are not flagged. Thresholds are
deterministic arithmetic; exact thresholds are open question 4.

**`no-weak-crypto`** — gate: the file references `crypto` or `node:crypto`.
Flags a CallExpression whose callee is a PropertyAccessExpression named
`createHash` (receiver unconstrained — no colliding common method) or a bare
`createHash` identifier not shadowed by a same-file binding, when the first
argument is a string literal whose value lowercased is `md5` or `sha1` (the
PLAN's list; nothing else in v1). No function-body restriction: a weak hash is
weak at module top level too. Non-literal algorithms are not flagged (cannot
be resolved statically). Cache-key/etag use of md5 is the known acceptable use
— the rule doc says to downgrade or ignore the rule for that case, and the
message mentions it.

**`no-ssrf`** — flags a CallExpression whose first argument contains request
input, where the callee is: bare `fetch` not shadowed by a same-file binding
(the spec 005 fetch precedent — a user's own `fetch` function is not the
global), or `axios` / `axios.get|post|put|patch|delete|request` (property or
bare form) with the gate that the file references an `axios` module specifier.
Literal or literal-only-template URLs are not flagged. Config-object forms
(`axios({ url: req.query.target })`) are a documented recall hole.

**`no-unsafe-merge`** — no module gate (`Object.assign` is a global; unshadowed
bare `merge` is lodash-shaped anyway). Flags a CallExpression whose callee is
`Object.assign`, or a merge-family name (`merge`, `mergeWith`, `defaultsDeep`,
`deepmerge`) as a bare identifier not shadowed by a same-file binding or as a
property access on the receivers `_` or `lodash`, when any argument contains
request input. Trusted-object merges (no request input) are not flagged.
Spread (`{ ...req.body }`) is not a call and is not flagged (documented recall
hole — the fix suggestion in the doc covers prototype-safe copying).

### Pipeline and unchanged contracts

- Rules are added to `productRules` in `src/rules/index.ts`; `allRules()` feeds
  both `REGISTERED_RULE_IDS` (`src/cli/commands/scan.ts:23`) and the runner, so
  config validation accepts the new ids everywhere automatically (mechanism from
  spec 004 AC-11, reused by specs 005/006). The registry-count assertion in
  `tests/unit/rules/blocking.test.ts` grows from 10 to 16.
- `schemaVersion` stays 1; exit codes stay 0/1/2; report on stdout, errors on
  stderr; jsonl unchanged (diagnostics only). The six rules are warn-by-default,
  so a scan of an offending tree still exits 0 until a user escalates.
- Report ordering is the existing `sortDiagnostics` — new diagnostics
  interleave deterministically by file/line/column/rule.
- `parser/types.ts` grows type-only re-exports (`StringLiteral`,
  `TemplateExpression`, `VariableDeclaration`, `PropertyDeclaration`,
  `PropertyAssignment`, `ObjectLiteralExpression`) per constitution §4 (the
  adapter grows first; no runtime adapter changes expected — every detection
  above is expressible with the existing traversal plus node guards).
- Existing pinned outputs stay valid: `tests/fixtures/engine/bad-app/src/`
  contains no `child_process`/`path`/`crypto`/`axios` imports, no `req`-rooted
  accesses, no `createHash`, no merges, and its only string literals are short
  low-entropy literals (verified 2026-09-20); the integration/e2e temp trees
  staged by async/blocking tests are likewise clean.

## EARS acceptance criteria

**no-command-injection**

- **AC-1:** WHEN a file referencing a `child_process` module specifier contains
  a call to `exec`/`execSync` (property or bare-identifier form) whose first
  argument exists and is not a string literal, THE SYSTEM SHALL report exactly
  one diagnostic positioned at the start of the call expression.
- **AC-2:** WHEN the first argument is a string literal, or the bare callee is
  bound by a same-file declaration or the enclosing class, or the file
  references no `child_process` specifier, or the call is
  `spawn`/`execFile`/`fork`, THE SYSTEM SHALL NOT report.

**no-path-traversal**

- **AC-3:** WHEN a `path.join`/`path.resolve` call (receiver exactly the
  identifier `path`, or an unshadowed bare `join`/`resolve`) in a file
  referencing a `path` module specifier has an argument containing request
  input, THE SYSTEM SHALL report exactly one diagnostic at the start of the
  call.
- **AC-4:** WHEN no argument contains request input (literals, own variables,
  other root names), or the receiver is another object (e.g. an array's
  `join`), or the file references no `path` specifier, THE SYSTEM SHALL NOT
  report.

**no-hardcoded-secrets**

- **AC-5:** WHEN a variable declaration, class property, or object-literal
  property whose normalized name contains a pinned secret name is initialized
  with a string literal of length ≥ 16 and entropy ≥ 3.0 bits, THE SYSTEM SHALL
  report exactly one diagnostic positioned at the start of the declaration.
- **AC-6:** WHEN the initializer is not a string literal, or the literal is
  shorter than 16 or has entropy below 3.0 bits, or the name matches no pinned
  secret name (e.g. bare `token`), THE SYSTEM SHALL NOT report.

**no-weak-crypto**

- **AC-7:** WHEN a `createHash` call (property or unshadowed bare form) in a
  file referencing a crypto module specifier passes a string-literal first
  argument whose value lowercased is `md5` or `sha1`, THE SYSTEM SHALL report
  exactly one diagnostic at the start of the call — including at module top
  level.
- **AC-8:** WHEN the algorithm literal is anything else (`sha256`), the
  argument is not a literal, or the file references no crypto specifier, THE
  SYSTEM SHALL NOT report.

**no-ssrf**

- **AC-9:** WHEN a `fetch(…)` call (unshadowed bare identifier) or an
  `axios(…)`/`axios.<method>(…)` call in a file referencing an axios specifier
  has a first argument containing request input, THE SYSTEM SHALL report
  exactly one diagnostic at the start of the call.
- **AC-10:** WHEN the first argument is a plain literal or a literal-only
  template, `fetch` is bound by a same-file declaration, or the request input
  sits in a non-first argument, THE SYSTEM SHALL NOT report.

**no-unsafe-merge**

- **AC-11:** WHEN a call to `Object.assign`, or to an unshadowed bare
  `merge`/`mergeWith`/`defaultsDeep`/`deepmerge`, or to the same names on the
  receivers `_`/`lodash`, has an argument containing request input, THE SYSTEM
  SHALL report exactly one diagnostic at the start of the call.
- **AC-12:** WHEN no argument contains request input, or the callee is a
  same-file merge helper, or the merge is a spread expression, THE SYSTEM SHALL
  NOT report.

**Registry and pipeline**

- **AC-13:** WHEN `src/rules/index.ts` is imported, THE SYSTEM SHALL have all
  six new rules registered with unique ids (sixteen product rules total).
- **AC-14:** WHEN config sets one of the six ids to `"error"` and a matching
  diagnostic is found, THE SYSTEM SHALL emit it with severity `error` and the
  CLI shall exit 1; WHEN the id is set to `"off"` or listed in
  `ignore.rules`, THE SYSTEM SHALL emit no diagnostic for it.
- **AC-15:** WHEN the same tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports including the new rules' diagnostics.

## Testing strategy (TDD)

- **Fixtures** under `tests/fixtures/backend-doctor/<short-id>/{valid,invalid}/`
  (constitution §3), one finding per invalid file where practical:
  - `no-command-injection/invalid/`: `template-exec.ts` (exec(`rm ${dir}`)),
    `concat-sync.ts` (execSync("ls " + dir)), `bare-import.ts` (named `exec`
    with a variable argument);
    `valid/`: `literal-arg.ts`, `spawn-not-shell.ts` (spawn with argument
    array), `own-function.ts` (same-file `exec` helper — shadow),
    `no-child-process-import.ts` (`db.exec` in a file without the specifier).
  - `no-path-traversal/invalid/`: `join-req-params.ts`,
    `resolve-req-body.ts`, `template-join.ts`;
    `valid/`: `trusted-args.ts`, `array-join.ts`, `other-root.ts`
    (`ctx.params`), `no-path-import.ts`.
  - `no-hardcoded-secrets/invalid/`: `const-api-key.ts`,
    `class-property.ts`, `object-literal.ts` (literals chosen to clear both
    thresholds by wide margins, e.g. 30+ char mixed-case alphanumerics);
    `valid/`: `env-access.ts`, `short-literal.ts`, `low-entropy.ts`
    (repetitive literal over the length threshold), `ambiguous-name.ts`
    (`cacheToken`).
  - `no-weak-crypto/invalid/`: `md5-literal.ts`, `sha1-property.ts`,
    `uppercase-md5.ts` (pins case-insensitivity), `top-level.ts`;
    `valid/`: `sha256.ts`, `non-literal-algo.ts`, `no-crypto-import.ts`.
  - `no-ssrf/invalid/`: `fetch-req-url.ts`, `axios-get.ts`,
    `template-fetch.ts`;
    `valid/`: `literal-url.ts`, `shadowed-fetch.ts`, `no-axios-import.ts`,
    `other-root.ts`.
  - `no-unsafe-merge/invalid/`: `lodash-merge.ts`, `object-assign.ts`,
    `bare-deepmerge.ts`;
    `valid/`: `trusted-args.ts`, `shadowed-merge.ts`, `spread-not-call.ts`.
  The existing fixtures, `bad-app`, and all integration/e2e staged trees stay
  untouched and clean for these rules (verified 2026-09-20).
- **Unit** `tests/unit/rules/security.test.ts` (extend) — refactor its
  two-rule `scanFixture` into the `blocking.test.ts` map pattern, then cover
  AC-1..12 with exact diagnostics (file/line/column/message/severity/category)
  for invalid fixtures and `[]` for valid ones, using the real
  `TsMorphParserAdapter`, `runRules`, `defaultConfig()`,
  `detectedFrameworks: []`.
- **Registry** — the assertion in `tests/unit/rules/blocking.test.ts`
  ("product registry") grows to the six new ids and total 16 (AC-13).
- **Integration** `tests/integration/scan.test.ts` (extend) — one temp project
  staging all six violation shapes in one file: `runScan` returns the six
  diagnostics in report order at `warn`; a config escalation flips one to
  `error` (AC-14 at the engine level).
- **e2e** `tests/e2e/security-rules.test.ts` (new, temp tree via
  `runCli`/`makeTmpDir`) — json diagnostics contain the six ids from a real bin
  run at exit 0; escalation to `error` flips exit code to 1; `"off"` config
  empties the report; two consecutive json scans are byte-identical (AC-14,
  AC-15 end to end).
- **Docs** — one rule doc per rule (constitution §3): Bad/Good examples, Scope
  notes covering every recall hole named in this spec, Configuration snippet.
- No new dependencies; no committed fixtures beyond the per-rule ones.

## Open questions for review

1. **Rule ids (six config keys).** Recommendation: the table in the Contract —
   `no-command-injection`, `no-path-traversal`, `no-hardcoded-secrets`,
   `no-weak-crypto`, `no-ssrf`, `no-unsafe-merge`. Alternatives considered:
   `no-dynamic-shell-exec`, `unsafe-path-join`, `hardcoded-credentials`,
   `no-md5-sha1`, `no-unvalidated-url`, `no-prototype-pollution`. The ids are
   config keys — user-owned.
2. **Categories.** Recommendation: all six under `Security` (the category
   already exists with `no-eval`/`no-new-func`; the defect class is exploit
   paths, not crashes or latency). Alternative: secrets under `Configuration`
   — rejected: their risk is disclosure, not misconfiguration. Categories are
   config surface — user-owned.
3. **`Object.assign` inside `no-unsafe-merge`.** PLAN says "deep merge", but
   `Object.assign(target, req.body)` is the most common real prototype-pollution
   write (its `__proto__` set semantics make it a real vector), and the
   request-input gate keeps it precise. Recommendation: include it. Alternative:
   lodash/deepmerge family only — a deliberate shrink of the rule.
4. **Secret thresholds.** Recommendation: string literal with length ≥ 16 AND
   Shannon entropy ≥ 3.0 bits, compound secret names only (bare
   `secret`/`token`/`key`/`credentials` excluded). This trades short-password
   recall (`const pw = "s3cr3t!"` is missed) for a safe FP budget. Alternative:
   length ≥ 8 with a placeholder denylist (`changeme`, `dummy`, …) — more
   recall, noticeably noisier on config-ish constants. The thresholds live in
   the rule doc either way.
5. **Shell-exec scope.** Recommendation: `exec`/`execSync` only — they invoke a
   shell, which is what makes interpolation exploitable; `spawn`/`execFile`
   with argument arrays are the fix the message points to. Alternative: also
   flag `spawn(cmd)` when the options literal contains `shell: true` — more
   recall, one more shape to pin and document; propose as a follow-up if F022
   shows demand.
6. **New dependencies.** Recommendation: none — entropy is five lines of
   arithmetic, request-input matching is a parent walk, everything else is the
   existing adapter vocabulary. Alternative: an entropy/heuristics helper
   package — rejected (dependency for trivial math).
