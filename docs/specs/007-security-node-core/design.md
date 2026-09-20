# Design 007 — Security rules, Node core

## Module layout

- `src/rules/shared/module-api-calls.ts` — **NEW** generalized collector
  `findModuleApiCalls(file, opts)`: optional module-specifier gate (absent =
  no gate), callee-name match (property form unconstrained receiver + bare
  identifier with shadow check + `this.<member>` own-class-member check),
  optional `accept` predicate, `insideFunctionBodies` option (default `true`).
  The F006 logic from `sync-module-calls.ts` moves here unchanged.
- `src/rules/blocking/sync-module-calls.ts` — **DELETED**; `sync-fs.ts` and
  `sync-crypto.ts` call `findModuleApiCalls` with
  `insideFunctionBodies: true` (2-line import change each). Their fixture
  tests pin the behavior through the refactor.
- `src/rules/security/request-input.ts` — **NEW**
  `containsRequestInput(expression)`: req/request-rooted property chains,
  recursive through parentheses, template substitutions, `+` operands.
- `src/rules/security/secrets.ts` — **NEW** pure predicates:
  `shannonEntropy`, `normalizeName`, `isSecretName` (pinned 20-name list),
  `isSecretLiteral` (length ≥ 16 ∧ entropy ≥ 3.0).
- `src/rules/security/no-command-injection.ts`, `no-path-traversal.ts`,
  `no-hardcoded-secrets.ts`, `no-weak-crypto.ts`, `no-ssrf.ts`,
  `no-unsafe-merge.ts` — **NEW** rule files.
- `src/rules/index.ts` — +6 entries (16 total).
- `src/engine/parser/types.ts` — +type-only re-exports as rules need them
  (`StringLiteral`, `TemplateExpression`, `VariableDeclaration`,
  `PropertyDeclaration`, `PropertyAssignment`); no runtime adapter changes.
- Tests: `tests/unit/rules/module-api-calls.test.ts` (NEW — collector
  options), `tests/unit/rules/security-helpers.test.ts` (NEW — request-input
  shapes + secret math), `tests/unit/rules/security.test.ts` (extend to the
  map pattern + six rule describes), `tests/unit/rules/blocking.test.ts`
  (registry 10 → 16), `tests/integration/scan.test.ts` (extend),
  `tests/e2e/security-rules.test.ts` (NEW).
- Docs: `docs/rules/backend-doctor/<six ids>.md`.

## Key decisions

1. **Generalize the F006 collector instead of duplicating it.** All six rules
   share the gate/shadow/own-member callee matching. Alternative: copy the
   logic per rule — six divergent copies of the same 60 lines; rejected. The
   two F006-specific knobs become options: `specifiers` optional (undefined =
   no gate — `fetch`, `Object.assign` are globals; secrets have no import) and
   `insideFunctionBodies` (default `true`; security rules pass `false` — no
   top-level exemption for exploit paths, unlike F006's blocking rules where
   init-time blocking is idiomatic).
2. **Request input = property chains rooted at the exact identifiers `req` /
   `request`**, matched directly, through parens, in template substitutions,
   or as `+` operands (one recursive predicate). Alternatives rejected:
   parameter-name taint (any function with a `req` parameter — much wider FP
   surface), string matching on argument source text (`getText().includes()`
   — matches comments and unrelated identifiers' substrings).
3. **Receiver constraints travel in per-rule `accept` predicates.** F006 left
   receivers unconstrained because `*Sync` names don't collide; `join`
   (Array.prototype.join), `get`/`post` (HTTP clients), `merge` and `exec`
   (db drivers) do. So: `no-path-traversal` requires receiver identifier
   `path`; `no-ssrf` requires receiver `axios` or bare `axios`/`fetch`;
   `no-unsafe-merge` requires `Object.assign`, `_`/`lodash` receivers, or
   bare merge-family names (shadow-checked). Bare `fetch` only (no
   `globalThis.fetch`) — spec 005 precedent, documented hole.
4. **Secret math.** Normalize names by lowercasing and removing `_`, `-`, `$`,
   spaces; flag when the normalized name *contains* one of 20 pinned compound
   names (bare `secret`/`token`/`key`/`credentials` excluded — `cacheToken`
   and `key` params would burn the budget). Flag string literals with
   length ≥ 16 AND Shannon entropy ≥ 3.0 bits, H = −Σ (c_i/n)·log2(c_i/n).
   Boundaries: 16 distinct chars → 4.0 bits (flagged), 16 identical → 0
   (not flagged), `changeme-changeme-changeme` ≈ 2.6 (not flagged), random
   30-char base62 ≈ 4.5 (flagged). Alternatives rejected: length ≥ 8 +
   placeholder denylist (noisier), value-shape regexes (sk_live_, AKIA… —
   complementary, deferred; documented hole).
5. **Detection shapes per rule** (what the `accept` predicates check):
   - `no-command-injection`: first argument exists ∧ not a StringLiteral
     (spread-only ⇒ flagged, spec 006 precedent).
   - `no-path-traversal`: any non-spread argument `containsRequestInput`.
   - `no-weak-crypto`: first argument is a StringLiteral whose value
     lowercased is `md5` or `sha1`.
   - `no-ssrf`: two collector passes (ungated bare `fetch`; axios-gated
     `axios`/`get`/`post`/`put`/`patch`/`delete`/`request`), first argument
     contains request input.
   - `no-unsafe-merge`: any non-spread argument contains request input.
   Spread arguments are skipped by the request-input/argument helpers (a
   spread's target expression is not resolvable to a shape we trust).
6. **One message per rule** (registry precedent), each naming the exploit and
   the fix (see rule files; pinned by the exact-diagnostic tests).
7. **Reporting position**: the call expression for the five call-based rules;
   the declaration/property node start for `no-hardcoded-secrets`.
8. **Type-only adapter growth** (constitution §4): every detection above is
   expressible with `forEachDescendant` + node guards over the existing
   surface; `parser/types.ts` re-exports only the new AST types the guards
   need.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1, AC-2 | `tests/unit/rules/security.test.ts` — `no-command-injection` describes over its invalid/valid fixtures |
| AC-3, AC-4 | `tests/unit/rules/security.test.ts` — `no-path-traversal` |
| AC-5, AC-6 | `tests/unit/rules/security.test.ts` — `no-hardcoded-secrets` |
| AC-7, AC-8 | `tests/unit/rules/security.test.ts` — `no-weak-crypto` |
| AC-9, AC-10 | `tests/unit/rules/security.test.ts` — `no-ssrf` |
| AC-11, AC-12 | `tests/unit/rules/security.test.ts` — `no-unsafe-merge` |
| AC-13 | `tests/unit/rules/blocking.test.ts` — registry assertion (16 ids, unique) |
| AC-14 | `tests/integration/scan.test.ts` — security block (warn order + escalation); `tests/e2e/security-rules.test.ts` — escalation + off path through the bin |
| AC-15 | `tests/e2e/security-rules.test.ts` — byte-identical consecutive scans |

Helper pins: `tests/unit/rules/module-api-calls.test.ts` (no-gate mode,
`insideFunctionBodies: false` at module top level, gate still enforced);
`tests/unit/rules/security-helpers.test.ts` (request-input shapes incl.
negatives; entropy boundaries 0 / 4.0 bits, length boundary, name
normalization, ambiguous-name exclusion).
