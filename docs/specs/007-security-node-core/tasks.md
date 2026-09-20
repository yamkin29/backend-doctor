# Tasks 007 — Security rules, Node core

TDD order: shared helpers first (things tests import), then rules (fixtures +
exact diagnostics), then registry, pipeline, docs, close-out.

- [ ] **T1. Generalize the F006 collector (design §1).** RED:
  `tests/unit/rules/module-api-calls.test.ts` — no-gate mode finds bare and
  property calls; `insideFunctionBodies: false` matches module top level;
  default `true` does not; the specifier gate still filters. GREEN:
  `src/rules/shared/module-api-calls.ts` (logic moved from
  `sync-module-calls.ts`), `sync-fs.ts`/`sync-crypto.ts` call it with
  `insideFunctionBodies: true`, `sync-module-calls.ts` deleted;
  `blocking.test.ts` stays green.
- [ ] **T2. Request-input + secret-literal helpers (design §2, §4).** RED:
  `tests/unit/rules/security-helpers.test.ts` — `containsRequestInput` direct
  chain / parens / template / `+` operands and negatives (literal, other root,
  element access, `req` whole, call result, non-plus binary);
  `shannonEntropy` boundaries (0 bits for repeated chars, 4.0 for 16 distinct),
  `isSecretLiteral` length+entropy matrix, `normalizeName`, `isSecretName`
  (compound names match, bare `token` does not). GREEN:
  `src/rules/security/request-input.ts`, `src/rules/security/secrets.ts`;
  `parser/types.ts` type re-exports as needed.
- [ ] **T3. `no-command-injection` (AC-1..2).** RED: fixtures
  `no-command-injection/{invalid,valid}/` + exact-diagnostic describes in
  `security.test.ts`. GREEN: `src/rules/security/no-command-injection.ts`.
- [ ] **T4. `no-path-traversal` (AC-3..4).** RED: fixtures + describes. GREEN:
  `src/rules/security/no-path-traversal.ts`.
- [ ] **T5. `no-hardcoded-secrets` (AC-5..6).** RED: fixtures + describes.
  GREEN: `src/rules/security/no-hardcoded-secrets.ts`.
- [ ] **T6. `no-weak-crypto` (AC-7..8).** RED: fixtures + describes. GREEN:
  `src/rules/security/no-weak-crypto.ts`.
- [ ] **T7. `no-ssrf` (AC-9..10).** RED: fixtures + describes. GREEN:
  `src/rules/security/no-ssrf.ts`.
- [ ] **T8. `no-unsafe-merge` (AC-11..12).** RED: fixtures + describes. GREEN:
  `src/rules/security/no-unsafe-merge.ts`.
- [ ] **T9. Registry: 16 product rules (AC-13).** RED: `blocking.test.ts`
  registry assertion grows to the six new ids and total 16. GREEN:
  `src/rules/index.ts` +6 entries.
- [ ] **T10. Integration contract (AC-14).** RED→GREEN: `scan.test.ts`
  security block — one staged file with all six violation shapes produces the
  six diagnostics in report order at `warn`; escalating one id to `error`
  flips only that diagnostic.
- [ ] **T11. e2e contract through the bin (AC-14, AC-15).** RED→GREEN:
  `tests/e2e/security-rules.test.ts` — warn + exit 0; escalation to `error`
  flips exit code to 1; `"off"` config empties the report; two consecutive
  json scans byte-identical.
- [ ] **T12. Rule docs (constitution §3). No TDD.** Six
  `docs/rules/backend-doctor/<id>.md`: Problem, Bad, Good, Scope notes
  covering every recall hole from the spec, Configuration.
- [ ] **T13. Close-out.** Check off tasks, record deviations, spec status →
  `Implemented`, `docs/PLAN.md` F007 → `Done`.

## Deviations & notes

(appended during implementation)
