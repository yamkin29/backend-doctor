# Tasks 008 — Nest app model

TDD order: types first (no behavior), then extractor clusters ordered by what
tests import, then pipeline wiring, then e2e, close-out last. Every task runs
red → green → refactor; only green states are committed.

- [ ] **T1. Model types + parser vocabulary growth (no AC — pure types).**
  No TDD — type-only surface. GREEN: `src/framework/nest/model.ts` (all
  `NestAppModel` types); `parser/types.ts` type-only re-exports
  (`ClassDeclaration`, `Decorator`, `MethodDeclaration`,
  `ObjectLiteralExpression`, `PropertyAssignment`, `ArrayLiteralExpression`,
  `SpreadElement`, `StringLiteral`). Suite + typecheck stay green.
- [ ] **T2. File gate + module extraction (AC-1, AC-6).** RED: unit
  `tests/unit/framework/nest-model.test.ts` — module entries from
  `app.module.ts` and `users/users.module.ts` (identifier refs verbatim,
  `useClass` captured), no entries from `plain/*` (own decorators, no
  `@nestjs/` import). GREEN: `extract.ts` skeleton — per-file gate, class
  traversal, `@Module` metadata reading.
- [ ] **T3. Controllers & handlers (AC-2).** RED: `@Controller('users')` with
  `@Get()`, `@Get(':id')`, `@Post()` handlers; undecorated method absent;
  bare `@Controller` → `route: null`. GREEN: controller extraction.
- [ ] **T4. Providers (AC-3).** RED: `@Injectable()` classes become provider
  entries. GREEN: provider extraction.
- [ ] **T5. DTOs (AC-4).** RED: `CreateUserDto` via `suffix` (ungated file),
  `@InputType` class via `decorator`, `UserEntity` negative. GREEN: dto
  extraction (suffix first, then decorator).
- [ ] **T6. Unresolved references (AC-5).** RED: `dynamic/dynamic.module.ts`
  fixture — `useFactory` element, spread element, non-object `@Module`
  metadata → `unresolved` entries with positions and stable reasons; readable
  siblings kept. GREEN: unresolved capture.
- [ ] **T7. Deterministic ordering + empty model (AC-8 unit half, AC-10
  extractor half).** RED: sort orders (entries by file+name, unresolved by
  file+line+column), double extraction deep-equals, empty input → five empty
  arrays. GREEN: sorting + empty-path shape.
- [ ] **T8. Pipeline wiring (AC-7 engine half, AC-9, AC-10 report half,
  AC-11).** RED: `buildNestModelOrSkip` with a throwing adapter (AC-9);
  `runner.test.ts` rule observes `ctx.nest` (AC-11); `scan.test.ts` nest tree
  exposes `projects[0].nest`, non-nest tree has no `nest` key, decorator-less
  nest tree exposes the empty model (AC-7/AC-10). GREEN: `core/types.ts`
  `ProjectInfo.nest?`, `runner.ts` passthrough, `scan.ts` gate + skippedChecks.
- [ ] **T9. e2e through the bin (AC-7, AC-8 end to end).** RED:
  `tests/e2e/nest-model.test.ts` — json carries the expected
  `projects[0].nest` names from a real bin run; non-nest tree has no `nest`
  key; two consecutive scans byte-identical; jsonl stays diagnostics-only.
  GREEN: expected to be wiring fixes only.
- [ ] **T10. Close-out (no AC — bookkeeping).** Check off tasks, record
  deviations (incl. the design-time gate refinement and any ts-morph API
  findings → `docs/RESEARCH.md`), spec status → `Implemented`,
  `docs/PLAN.md` F008 → `Done`.

## Deviations & notes

- (close-out fills this in)
