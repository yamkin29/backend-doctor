# Design 010 — Rules: layers & DTO

## Module layout

Changed:

- `src/framework/nest/model.ts` — `NestInjectionRef.decoratorNames`,
  `NestProviderEntry.publicMethods`, new `NestDtoPropertyRef`,
  `NestDtoEntry.properties`.
- `src/framework/nest/extract.ts` — `decoratorNames` in `readInjections`,
  new `readPublicMethods`, new `readDtoProperties`.
- `src/engine/parser/types.ts` — type-only re-export `PropertyDeclaration`
  (the only new AST vocabulary needed; see decision D2).
- `src/rules/index.ts` — register the six rules.

New rule modules (`src/rules/nest/`, named after the rule id sans prefix):

- `no-business-logic-in-controller.ts`
- `no-repository-in-controller.ts`
- `no-god-service.ts`
- `missing-global-validation-pipe.ts`
- `dto-field-without-validator.ts`
- `no-any-in-dto.ts`

Tests and fixtures:

- `tests/unit/framework/nest-model.test.ts` — extended (AC-1..3).
- `tests/unit/rules/layers-dto.test.ts` — new, one `describe` per rule + a
  pack-silence/model-absent describe (AC-4..10, AC-14).
- `tests/unit/rules/blocking.test.ts` — registry count 20 → 26.
- `tests/integration/scan.test.ts` — extended (AC-11).
- `tests/e2e/layers-dto-rules.test.ts` — new (AC-12, AC-13).
- `tests/fixtures/nest/layers-dto/<short-name>/{valid,invalid}/` — fixture
  trees per spec.
- `docs/rules/backend-doctor/<six rule ids>.md`.

## Key decisions

1. **Model-first rules.** `no-repository-in-controller`, `no-god-service`,
   `dto-field-without-validator`, `no-any-in-dto` are pure queries over
   `ctx.nest` (entries filtered by `filePath === ctx.file.filePath`,
   spec 009 precedent) — no AST access at all.
   `no-business-logic-in-controller` maps model handlers to AST by
   `(className, handlerName)` and reads only the handler body.
   `missing-global-validation-pipe` scans the file AST and consults the
   model's module providers lists. Alternative — re-detecting verb/class
   decorators inside each rule — rejected: it duplicates the F008 extraction
   gate and breaks the model boundary (constitution §4).
2. **Branch-point counting via kind census.** `forEachDescendant` over the
   handler method node, counting `SyntaxKind` occurrences: `IfStatement`,
   `ForStatement`, `ForOfStatement`, `ForInStatement`, `WhileStatement`,
   `DoStatement`, `ConditionalExpression`, `CaseClause`. `DefaultClause` is
   not counted (cyclomatic precedent: the default arm is the fall-through
   path, not a branch). Logical operators (`&&`/`||`) are not counted (spec).
   No type narrowing is needed, so no new statement-type re-exports in
   `parser/types.ts` — the spec's testing-strategy list was illustrative;
   only `PropertyDeclaration` is actually required (extraction helper
   signatures). Recorded as a wording deviation, not a behavior change.
   Probed (ts-morph v28): all eight kinds are distinct descendants of the
   method node; a `switch` yields `CaseBlock` + `CaseClause`s.
3. **Positions.** A decorated DTO property positions at its leading `@`
   (probed: `@ApiProperty() name: string;` starts at the `@` column) — same
   family as the spec 008/009 class/parameter precedent. Snapshot coordinates
   are pinned from real runs, never counted by hand.
4. **`typeText` comparison is whitespace-collapsed.** `getTypeNode().getText()`
   preserves source spacing (`"Array < any >"`, probed), so the `any`-form
   check compares against `any` / `any[]` / `Array<any>` after
   `replace(/\s+/g, "")`.
5. **`publicMethods` = methods only.** `cls.getMethods()` filtered by
   `!isStatic() && getScope() === "public" && !LIFECYCLE_HOOKS.has(name)`;
   `LIFECYCLE_HOOKS` = `onModuleInit`, `onModuleDestroy`,
   `onApplicationBootstrap`, `beforeApplicationShutdown`,
   `onApplicationShutdown`. Accessors (`get`/`set`) are not counted.
   `getScope()` verified to exist on v28 (probe); properties expose it too,
   which `readDtoProperties` does not need (statics are excluded by
   `isStatic()` outright).
6. **ValidationPipe fail-open predicate reads `unresolved` reasons.** The
   model has no per-module linkage for unresolved entries, so "a module's
   providers metadata is unresolved" is: any `model.unresolved` entry whose
   `reason` is `"@Module metadata is not a static object literal"` (blocks
   every list including providers) or contains `"providers"` (covers
   `"providers" is not a static array`, `spread element in providers array`,
   `object literal element in providers array without a readable class
   reference`, `non-identifier element in providers array`). The reason
   strings are our own stable constants from `extract.ts`. Alternative — a
   per-module `providersUnresolved` flag — rejected: a model change beyond
   the approved spec for one rule.
7. **ValidationPipe detection shapes.** `NestFactory.create*` = a
   `CallExpression` whose callee is a `PropertyAccessExpression` with
   identifier object `NestFactory` and member name in {`create`,
   `createApplicationContext`, `createMicroservice`}. Global pipe in file = a
   `CallExpression` whose expression is a `PropertyAccessExpression` named
   `useGlobalPipes` with any argument being a `NewExpression` whose callee
   text is `ValidationPipe`. Module providers path = any module entry whose
   `providers` list contains `"ValidationPipe"` (the
   `{ provide: APP_PIPE, useClass: ValidationPipe }` shape is captured as
   exactly that by F008's `readableClassReference`).
8. **Recognition sets as frozen constants in the rules.** Repository =
   decorator name `InjectRepository` ∨ type name ends `Repository` ∨ type
   name ∈ {`PrismaService`, `PrismaClient`}. Non-validator blacklist per
   spec (19 names). Thresholds 2 / 6 / 12 as frozen constants with named
   exports where a test needs them (none planned — fixtures pin behavior).
9. **Registration in one commit.** All six rules enter `productRules` in one
   task with a single registry-count bump (20 → 26). Alternative — per-rule
   registration — rejected: six churn edits to `blocking.test.ts` for no
   safety gain (unit tests exercise rule objects directly, without the
   registry).
10. **No shared rule-side helpers.** The two DTO rules and the two
    Architecture rules each iterate model entries with a three-line filter;
    extracting a helper now would be premature abstraction (constitution
    §10). `extract.ts` grows two plain reader functions instead.
11. **No new dependencies** (spec resolution 4).

## Dependencies

None added. `class-validator`/`class-transformer`/TypeORM decorator
vocabularies are hardcoded name lists; the engine stays on ts-morph behind
the adapter.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/unit/framework/nest-model.test.ts` — injections carry parameter decorator names in source order; `@Optional` still excluded |
| AC-2 | same file — `publicMethods` in source order; lifecycle hooks, static, private, protected excluded; `[]` when none |
| AC-3 | same file — DTO properties: name, `typeText` (incl. `null`), decorator names, position; statics excluded; `[]` when none |
| AC-4 | `tests/unit/rules/layers-dto.test.ts` — `no-business-logic-in-controller` invalid fixture (2-`if` handler, `for`-of handler) exact diagnostics; valid fixture (guard clause, delegation, non-verb helper) empty |
| AC-5 | same file — `no-repository-in-controller` invalid (decorator, suffix, Prisma names); valid (same repositories in a service) empty |
| AC-6 | same file — `no-god-service` invalid (6 injections) exact; valid (5 injections) empty; temp-tree run pins the 12-method threshold (12 flags, 11 silent) |
| AC-7 | same file — `missing-global-validation-pipe` invalid (bare bootstrap) exact; valid (`useGlobalPipes` variant, APP_PIPE variant, providers-unresolved fail-open variant) empty |
| AC-8 | same file — `dto-field-without-validator` invalid (bare, `@ApiProperty`-only) exact; valid (`@IsString`, `@IsOptional`, `@ValidateNested`, `@Allow`) empty |
| AC-9 | same file — `no-any-in-dto` invalid (`any`, `any[]`, `Array<any>`, untyped-uninitialized) exact with both message variants; valid (concrete type, untyped-initialized) empty |
| AC-10 | same file — a file with no controller/provider/DTO entries produces no pack diagnostics |
| AC-11 | `tests/integration/scan.test.ts` — non-nest tree → no pack diagnostics; nest tree → findings through `runScan`; unit run with `nestModel: undefined` → no-op |
| AC-12 | `tests/e2e/layers-dto-rules.test.ts` — two `runCli` JSON runs byte-identical |
| AC-13 | same e2e file — rule `off` → no diagnostics; `error` → exit code 1 |
| AC-14 | per-rule existence assertions in `layers-dto.test.ts` (valid/invalid fixture dirs + `docs/rules/<id>.md` on disk), docs written per rule |
