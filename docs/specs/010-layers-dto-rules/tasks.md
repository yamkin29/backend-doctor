# Tasks 010 — Rules: layers & DTO

TDD order: model extensions first (rules and their tests depend on the
extracted data), then one rule per task (fixtures + failing test → rule
module + doc), then registry, pipeline, e2e, close-out.

- [x] **T1. Model extensions: `decoratorNames`, `publicMethods`, DTO properties (AC-1..3).**
      RED: extend `tests/unit/framework/nest-model.test.ts` — parameter
      decorator names in source order on injections (lifecycle/static/private
      exclusion for methods; static exclusion for DTO properties; `typeText`
      `null` when absent; positions printed on first failure).
      GREEN: `src/framework/nest/model.ts`, `src/framework/nest/extract.ts`
      (`readPublicMethods`, `readDtoProperties`, `decoratorNames` in
      `readInjections`), `src/engine/parser/types.ts` (re-export
      `PropertyDeclaration` if the helper signatures need it).
- [x] **T2. `backend-doctor/no-business-logic-in-controller` (AC-4, AC-14).**
      RED: fixtures `tests/fixtures/nest/layers-dto/controller-logic/{valid,invalid}/`,
      unit describe with exact diagnostics (2-`if` handler, `for`-of handler;
      guard clause / delegation / non-verb helper silent), doc-existence
      assertion. GREEN: `src/rules/nest/no-business-logic-in-controller.ts`,
      `docs/rules/backend-doctor/no-business-logic-in-controller.md`.
- [x] **T3. `backend-doctor/no-repository-in-controller` (AC-5, AC-14).**
      RED: fixtures `controller-repository/{valid,invalid}/` (decorator,
      `Repository` suffix, `PrismaService`; service injecting the same
      repositories stays silent), unit describe. GREEN: rule module + doc.
- [x] **T4. `backend-doctor/no-god-service` (AC-6, AC-14).**
      RED: fixtures `god-service/{valid,invalid}/` (6 injections flags, 5
      silent), unit describe incl. a temp-tree run pinning the 12-public-
      methods threshold (12 flags, 11 silent). GREEN: rule module + doc.
- [x] **T5. `backend-doctor/missing-global-validation-pipe` (AC-7, AC-14).**
      RED: fixtures `validation-pipe/{valid,invalid}/` (bare bootstrap flags;
      `useGlobalPipes` variant, APP_PIPE-provider variant, providers-unresolved
      fail-open variant silent), unit describe. GREEN: rule module + doc.
- [x] **T6. `backend-doctor/dto-field-without-validator` (AC-8, AC-14).**
      RED: fixtures `dto-fields/{valid,invalid}/`, unit describe (bare and
      `@ApiProperty`-only flagged; `@IsString`/`@IsOptional`/`@ValidateNested`/
      `@Allow` silent). GREEN: rule module + doc.
- [x] **T7. `backend-doctor/no-any-in-dto` (AC-9, AC-14).**
      RED: fixtures `any-fields/{valid,invalid}/`, unit describe (`any`,
      `any[]`, `Array<any>`, untyped-uninitialized flagged with the two
      message variants; typed and untyped-initialized silent). GREEN: model
      `hasInitializer`, rule module + doc.
- [x] **T8. Register the pack (AC-13 groundwork).**
      RED: flip the registry-count assertion in
      `tests/unit/rules/blocking.test.ts` to 26. GREEN: add the six rules to
      `productRules` in `src/rules/index.ts`.
- [x] **T9. Pipeline integration (AC-10, AC-11).**
      RED→GREEN: extend `tests/integration/scan.test.ts` — a staged Nest tree
      yields pack diagnostics through `runScan`; a non-nest tree yields none.
      Expected to pass immediately after T8 (wiring exists since F008) — if
      so, record as characterization.
- [x] **T10. e2e through the bin (AC-12, AC-13).**
      RED→GREEN: new `tests/e2e/layers-dto-rules.test.ts` — JSON diagnostics
      for the pack tree; two runs byte-identical; severity `off` (whole pack)
      → no diagnostics, `error` (no-god-service) → exit code 1; jsonl
      diagnostics-only; `expectSuccess` stdout purity. Characterization, as
      T9.
- [x] **T11. Close-out.**
      Check off tasks; record deviations in this file; spec status →
      `Implemented`; `docs/PLAN.md` F010 → Done.

## Deviations & notes

1. **`NestDtoPropertyRef.hasInitializer: boolean` added to the model**
   (T7, commit `df36804`). AC-9 requires telling "no annotation and no
   initializer" (implicit `any`) apart from "untyped but initialized"
   (silent), but the approved contract's property shape carried no
   initializer knowledge. The field is additive and implements the approved
   AC rather than changing it; no `schemaVersion` impact.
2. **`parser/types.ts` needed no new re-exports.** The spec's testing
   strategy listed statement-type re-exports (`IfStatement`, …); the
   branch-point census compares `node.getKind()` against `SyntaxKind`
   values, and everything else is carried by inference — the illustrative
   list shrank to nothing. Behavior unchanged.
3. **Fixture layout: `any-fields/` instead of reusing `dto-fields/`** (T7).
   Scanning both DTO files with one rule would have coupled each rule's
   expected output to the other rule's material (any-typed fields also lack
   validators). Separate trees keep the diagnostics decoupled.
4. **My first `dto-fields/valid` fixture contradicted the approved AC-8** —
   it held a `bio?: string` field decorated only with `@ApiPropertyOptional`,
   which AC-8 explicitly flags (metadata decorators are not validators). The
   failing test caught it; the rule was correct and unchanged, the fixture
   moved the field to `invalid/` and grew a validator. Committed as-is in
   T6's red→green cycle.
5. **T9/T10 red→green became characterization**, as anticipated in the task
   text: the pipeline wiring (pack gate, model, reporters) already worked
   after T8, so both pipeline-level test tasks passed on first run. The
   genuinely new machinery (rules, model fields) was TDD'd in T1–T8.
6. **Durable ts-morph facts moved to `docs/RESEARCH.md`** (deviations
   discipline): decorated *properties* also position at the leading `@`
   (completing the F008 class / F009 parameter pattern); `getScope()`
   exists on v28; `DefaultClause` is a separate kind from `CaseClause`;
   `getTypeNode().getText()` keeps source whitespace; no
   `getDescendantsAtKind` on nodes — use a `forEachDescendant` kind census.
