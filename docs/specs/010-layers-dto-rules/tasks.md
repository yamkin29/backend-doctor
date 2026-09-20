# Tasks 010 — Rules: layers & DTO

TDD order: model extensions first (rules and their tests depend on the
extracted data), then one rule per task (fixtures + failing test → rule
module + doc), then registry, pipeline, e2e, close-out.

- [ ] **T1. Model extensions: `decoratorNames`, `publicMethods`, DTO properties (AC-1..3).**
      RED: extend `tests/unit/framework/nest-model.test.ts` — parameter
      decorator names in source order on injections (lifecycle/static/private
      exclusion for methods; static exclusion for DTO properties; `typeText`
      `null` when absent; positions printed on first failure).
      GREEN: `src/framework/nest/model.ts`, `src/framework/nest/extract.ts`
      (`readPublicMethods`, `readDtoProperties`, `decoratorNames` in
      `readInjections`), `src/engine/parser/types.ts` (re-export
      `PropertyDeclaration` if the helper signatures need it).
- [ ] **T2. `backend-doctor/no-business-logic-in-controller` (AC-4, AC-14).**
      RED: fixtures `tests/fixtures/nest/layers-dto/controller-logic/{valid,invalid}/`,
      unit describe with exact diagnostics (2-`if` handler, `for`-of handler;
      guard clause / delegation / non-verb helper silent), doc-existence
      assertion. GREEN: `src/rules/nest/no-business-logic-in-controller.ts`,
      `docs/rules/backend-doctor/no-business-logic-in-controller.md`.
- [ ] **T3. `backend-doctor/no-repository-in-controller` (AC-5, AC-14).**
      RED: fixtures `controller-repository/{valid,invalid}/` (decorator,
      `Repository` suffix, `PrismaService`; service injecting the same
      repositories stays silent), unit describe. GREEN: rule module + doc.
- [ ] **T4. `backend-doctor/no-god-service` (AC-6, AC-14).**
      RED: fixtures `god-service/{valid,invalid}/` (6 injections flags, 5
      silent), unit describe incl. a temp-tree run pinning the 12-public-
      methods threshold (12 flags, 11 silent). GREEN: rule module + doc.
- [ ] **T5. `backend-doctor/missing-global-validation-pipe` (AC-7, AC-14).**
      RED: fixtures `validation-pipe/{valid,invalid}/` (bare bootstrap flags;
      `useGlobalPipes` variant, APP_PIPE-provider variant, providers-unresolved
      fail-open variant silent), unit describe. GREEN: rule module + doc.
- [ ] **T6. `backend-doctor/dto-field-without-validator` (AC-8, AC-14).**
      RED: fixtures `dto-fields/{valid,invalid}/`, unit describe (bare and
      `@ApiProperty`-only flagged; `@IsString`/`@IsOptional`/`@ValidateNested`/
      `@Allow` silent). GREEN: rule module + doc.
- [ ] **T7. `backend-doctor/no-any-in-dto` (AC-9, AC-14).**
      RED: fixtures `dto-fields/` reuse, unit describe (`any`, `any[]`,
      `Array<any>`, untyped-uninitialized flagged with the two message
      variants; typed and untyped-initialized silent). GREEN: rule module +
      doc.
- [ ] **T8. Register the pack (AC-13 groundwork).**
      RED: flip the registry-count assertion in
      `tests/unit/rules/blocking.test.ts` to 26. GREEN: add the six rules to
      `productRules` in `src/rules/index.ts`.
- [ ] **T9. Pipeline integration (AC-10, AC-11).**
      RED→GREEN: extend `tests/integration/scan.test.ts` — a staged Nest tree
      yields pack diagnostics through `runScan`; a non-nest tree yields none.
      Expected to pass immediately after T8 (wiring exists since F008) — if
      so, record as characterization.
- [ ] **T10. e2e through the bin (AC-12, AC-13).**
      RED→GREEN: new `tests/e2e/layers-dto-rules.test.ts` — JSON diagnostics
      for a god-service + missing-pipe tree; two runs byte-identical; severity
      `off` → no diagnostics, `error` → exit code 1; jsonl diagnostics-only;
      `expectSuccess` stdout purity. Same characterization caveat as T9.
- [ ] **T11. Close-out.**
      Check off tasks; record deviations in this file; spec status →
      `Implemented`; `docs/PLAN.md` F010 → Done.

## Deviations & notes

(appended during implementation)
