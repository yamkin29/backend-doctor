# Design 008 — Nest app model

## Module layout

- `src/framework/nest/model.ts` — the `NestAppModel` data types; imports
  nothing. Plain data: consumers never touch AST nodes.
- `src/framework/nest/extract.ts` — `extractNestAppModel(files, adapter)` plus
  the crash-isolating wrapper `buildNestModelOrSkip(files, adapter)`; the only
  new logic module, built on the existing `SourceFileView` traversal.
- `src/engine/parser/types.ts` — type-only re-export growth (extractor
  vocabulary) and the additive `RuleContext.nest` field.
- `src/engine/runner.ts` — `RunRulesOptions.nestModel?` and its passthrough
  into every `RuleContext`.
- `src/core/types.ts` — additive `ProjectInfo.nest?` (type-only import of the
  model types).
- `src/core/scan.ts` — builds the model once when `nest` is detected; pushes a
  `skippedChecks` entry on extraction failure; exposes the model on the result
  and on `projects[0]`.
- Tests: fixtures `tests/fixtures/nest/model-app/`, unit
  `tests/unit/framework/nest-model.test.ts`, runner unit extension
  `tests/unit/engine/runner.test.ts`, integration extension
  `tests/integration/scan.test.ts`, e2e `tests/e2e/nest-model.test.ts`.

## Key decisions

1. **Model lives in `src/framework/nest/`.** `framework/` already owns
   Nest-specific logic (`detect.ts`, `markers.ts`); `src/rules/nest/` is
   reserved for rules (F009+); a new top-level `src/nest/` is not in the PLAN
   repository layout. Rejected: engine placement (the model is framework
   domain, not parser plumbing).
2. **Rules receive the model via optional `ctx.nest`.** Alternatives rejected:
   a second `create(ctx, app)` argument (breaks all sixteen rule signatures
   for no gain); a second rule kind `scan(app)` (react-doctor precedent, but
   premature — F009 rules are per-file rules with model lookups; F013 graph
   rules will introduce whole-tree scanning on its own terms); a module-level
   singleton (hidden state, untestable, constitution §1 hostile).
3. **Cross-file references stay name-only.** Decorator arrays store verbatim
   identifier names; consumers match them against model entries by class name.
   No import resolution, no ambiguity detection (duplicate class names across
   files are a consumer concern). The import graph is F013 territory.
4. **Gate scope: decorator-derived entries only.** Found while writing
   design.md: gating suffix DTOs by the `@nestjs/` import would drop the
   commonest DTO shape — plain `create-user.dto.ts` imports `class-validator`
   (or nothing), not `@nestjs/common`, making AC-4 unreachable. Suffix DTOs
   are collected from every analyzed file; decorator-derived entries keep the
   gate. Recorded in the spec Resolution; the fixtures carry both negatives
   (`plain/plain.service.ts`, `plain/plain.module.ts`).
5. **Roles are independent; no cross-role dedup.** `@Injectable() class
   FooDto` legitimately appears as both provider and dto (F009 wants the
   provider, F010 the dto). Within a role the first matching decorator wins
   (multiple `@Module` decorators are illegal Nest, but determinism demands a
   rule).
6. **Verb matching is exact PascalCase** (`Get`…`All`), stored lowercased in
   `NestHttpVerb`; a multi-verb method keeps only the first recognized
   decorator. Non-literal route/path arguments resolve to `null` — they are
   documented recall holes, NOT `unresolved` entries (contrast with module
   metadata, where unreadable elements feed F009's FP budget and must be
   loud).
7. **Positions resolved at extraction time** via
   `adapter.positionOf(file, node.getStart())` — model entries are plain data,
   so F009+ rules report through the `line`/`column` fallback without nodes.
   TS node spans include decorators, so a class position lands on the leading
   `@`; the unit tests pin exact coordinates (spec 007 workflow: first red
   run prints them).
8. **Crash isolation lives in `buildNestModelOrSkip`.** A wrapper returning
   `{ model?, failure? }` instead of an inline try/catch in `runScan` keeps
   the AC-9 path unit-testable with a throwing fake adapter and makes
   `runScan` a one-line call site.
9. **Type-only imports bridge the module layers** (`parser/types.ts` and
   `core/types.ts` import the model types without a runtime edge). Rejected:
   moving the model types into the engine (wrong domain) or duplicating them
   (drift).
10. **`src/index.ts` stays untouched.** Public-export growth is a
    stable-contract change with no consumer yet; the JSON report already
    exposes the shape (resolution of open question 1).
11. **`useClass`/`useExisting` identifier values are captured in all four
    module lists** (not just `providers`): `imports` can carry DynamicModule
    object literals whose `module:` class is what F009 needs; the same
    readable-class-or-unresolved rule applies uniformly.

## Dependencies

None added (resolution of open question 3). The extractor uses only the
existing traversal vocabulary plus ts-morph wrapper methods on re-exported
types — the spec 007 precedent for growing `parser/types.ts`.

## ts-morph API notes to pin in TDD

`Decorator.getCallExpression()`, `Decorator.getExpression()`,
`ObjectLiteralExpression.getProperties()`, `PropertyAssignment.getName()` /
`getInitializer()`, `ArrayLiteralExpression.getElements()`,
`StringLiteral.getLiteralText()`, `MethodDeclaration.getName()` — existence
and exact semantics pinned by the first red runs; findings land in
`docs/RESEARCH.md` (deviations discipline; RESEARCH already warns that
method names must be probed against the v28 prototype chain).

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | `tests/unit/framework/nest-model.test.ts` — module entries from `app.module.ts` + `users/users.module.ts` (full `toEqual`, incl. `useClass` capture) |
| AC-2 | same file — controller entry: route `"users"`, three handlers (`get`/`get :id`/`post`), undecorated method absent |
| AC-3 | same file — provider entry for `UsersService` |
| AC-4 | same file — `CreateUserDto` via `suffix`, `UserFilter` via `decorator`, `UserEntity`/services not in `dtos` |
| AC-5 | same file — `unresolved` entries for the `useFactory` element, the spread element, and non-object `@Module` metadata (dedicated `dynamic/` fixture), with positions and stable reasons |
| AC-6 | same file — `plain/plain.service.ts` and `plain/plain.module.ts` (own decorators, no `@nestjs/` import) yield no module/controller/provider entries |
| AC-7 | `tests/integration/scan.test.ts` (nest temp tree → `projects[0].nest` counts; non-nest tree → no `nest` key) + `tests/e2e/nest-model.test.ts` (JSON from the bin) |
| AC-8 | e2e double scan byte-identical + unit double-extract deep equality with sorted arrays |
| AC-9 | `tests/unit/framework/nest-model.test.ts` — `buildNestModelOrSkip` with a throwing adapter returns `failure` (`check: "nest-app-model"`) and no model |
| AC-10 | unit — empty target dir yields a model with five empty arrays; integration — nest-flagged tree without decorators exposes the empty model |
| AC-11 | `tests/unit/engine/runner.test.ts` — a rule observes `ctx.nest === ` the passed model; existing rules unaffected (suite stays green) |
