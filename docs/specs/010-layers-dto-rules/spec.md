# Spec 010 — Rules: layers & DTO (F010)

- **Status:** Approved (2026-09-20)
- **Phase:** 2 — Nest specifics & Prisma
- **Depends on:** F008 (Nest app model) — Done; F009 (DI rules: injections on
  model entries, `frameworks` pack gate, per-file model-query precedent) —
  Done; F003 (engine core) — Done; F004 (framework detection) — Done
- **Blocks:** F011 (reuses injection decorator names and provider method data
  for lifecycle checks), F012 (reuses DTO property data), F022 (eval corpus
  consumes this pack)

## Resolution (recorded at approval, 2026-09-20)

The user approved the spec as recommended ("принято"). All open questions
resolved as recommended: (1) business logic = the branch-point count (if +
loops + `case` clauses + ternaries), flag at ≥ 2, guard clauses silent;
(2) repository recognition = `@InjectRepository` decorator + `Repository`
name suffix + exact `PrismaService`/`PrismaClient`; (3) the new model fields
are serialized in `projects[].nest` (additive, no `schemaVersion` bump, per
the spec 009 resolution); (4) no new dependencies.

## Problem

F008 shipped the Nest application model — modules, controllers, providers,
DTOs — and F009 shipped the DI pack on top of it. What the model still does
not know is anything about *layering* or *shape*: how much branching a
controller handler holds, whether a controller reaches past its service layer
into a repository, how many responsibilities a service has accumulated,
whether the app validates input at its edge at all, and whether DTO fields are
actually validated or typed. These are the six failure modes the PLAN line
names — business logic in controller, controller → repository directly,
god-service, missing global `ValidationPipe`, DTO field without validator,
`any` in DTO. They are the classic slow rot of a Nest codebase: nothing
crashes at bootstrap, requests just get harder to change and easier to break.
None is detectable by the twenty shipped rules today. F010 extends the model
with exactly the layering data its rules need and ships the second Nest-gated
rule pack.

## Goals

- Six new rules, all gated `frameworks: ["nest"]`, all default `warn`
  (constitution §2):
  - `backend-doctor/no-business-logic-in-controller` (Architecture) — a
    controller handler whose body holds ≥ 2 branch points (if statements,
    loop statements, `case` clauses, conditional expressions): branching is
    business logic that belongs in a service.
  - `backend-doctor/no-repository-in-controller` (Architecture) — a
    controller constructor-injects a repository: `@InjectRepository`-decorated
    parameter, a type name ending in `Repository`, or the exact names
    `PrismaService` / `PrismaClient`.
  - `backend-doctor/no-god-service` (Maintainability) — a provider with ≥ 6
    constructor injections or ≥ 12 public instance methods; one diagnostic at
    the class with the actual counts in the message.
  - `backend-doctor/missing-global-validation-pipe` (Configuration) — a file
    calling `NestFactory.create*` where no `useGlobalPipes(new ValidationPipe(…))`
    appears in that file and no module providers entry names `ValidationPipe`
    (the `{ provide: APP_PIPE, useClass: ValidationPipe }` shape).
  - `backend-doctor/dto-field-without-validator` (Correctness) — a DTO
    property carrying no decorator outside the known non-validator set
    (`ApiProperty*`, GraphQL `Field`, class-transformer `Expose`/`Exclude`/
    `Type`/`Transform`, TypeORM column decorators): with a global pipe it is
    never validated.
  - `backend-doctor/no-any-in-dto` (Maintainability) — a DTO property typed
    `any`, `any[]` or `Array<any>`, or with neither a type annotation nor an
    initializer (implicitly `any`).
- Model extensions (additive to F008/F009, same precedent as spec 009 — the
  model grows when a rule pack needs more):
  - `NestInjectionRef.decoratorNames: string[]` — parameter decorator names in
    source order (recognizes `@InjectRepository` without hardcoding);
  - `NestProviderEntry.publicMethods: string[]` — public instance method names
    in source order, constructor and the five Nest lifecycle hooks excluded;
  - `NestDtoEntry.properties: NestDtoPropertyRef[]` — per property: name, type
    annotation text (`null` when absent), decorator names, 1-based position;
    static properties excluded.
- Precision gates (constitution §2): single guard-clause handlers stay silent;
  services injecting repositories are correct usage and never flagged; a DTO
  property with any decorator outside the non-validator blacklist counts as
  validated (unknown custom validators produce no finding); the
  ValidationPipe rule is silent when any module's providers metadata is
  unresolved (fail open).
- Determinism (constitution §1): all rules derive from the sorted model plus
  the file under scan; thresholds and decorator vocabularies are fixed
  constants; two scans are byte-identical.
- Unchanged contracts: `schemaVersion` stays 1, exit codes stay 0/1/2, no new
  CLI flags or config fields, reporters untouched. The JSON report's
  `projects[].nest` grows the new fields (open question 3 — additive under
  constitution §5, per the spec 009 resolution).

## Non-goals

- Type-aware analysis (the TS checker): repository/DTO/service recognition is
  by decorator names, class-name suffixes and type text as written — the
  engine stays syntax-only (spec 003).
- Import-graph layering: `no-repository-in-controller` matches injection
  names/decorators, not module paths; whole-project layering by file graph is
  F013 (graph rules).
- General maintainability metrics: no cyclomatic-complexity rule, no
  method-length or file-length rule — the branch-point count exists only as
  the controller-handler heuristic inside this pack.
- Nested-DTO validation: a `profile: ProfileDto` property without
  `@ValidateNested` is not flagged (only zero-decorator fields are);
  recognizing "type is another model DTO" is future work if the eval corpus
  demands it.
- ValidationPipe *options* (`whitelist`, `forbidNonWhitelisted`,
  `transform`): only presence/absence of a global pipe; option quality is
  runtime territory (F018+).
- Prisma rules: `PrismaService`/`PrismaClient` appear only as controller
  injection targets here; N+1, raw queries, pagination are F012.
- Errors & lifecycle (stack leaks, empty-catch, `onModuleDestroy`,
  constructor-vs-`onModuleInit`) — F011.
- God-service detection for controllers (only `@Injectable` providers are
  counted) and for non-Nest projects (the rule is nest-gated).
- `useGlobalPipes` registered in a file other than the bootstrap file, or via
  a shared setup function — documented recall hole (precision over recall).
- Multi-project/monorepo modeling; new dependencies; exit-code,
  `schemaVersion`, CLI flag or reporter changes.

## User stories

1. As a backend developer, I run `backend-doctor scan .` on my Nest app and
   get warnings at the exact handler, constructor parameter, class or DTO
   property where layering has rotted — a controller doing the service's job,
   a service that became a dumping ground, a DTO field that no pipe will ever
   validate — and each message names the concrete fix (move to a service,
   inject a service, add `@IsString()`), without flagging my guard clauses or
   my `@ApiProperty`-only fields as errors.
2. As a CI author, the pack behaves like every other pack: `warn` by default
   so exit code stays 0 until I promote rules, `--format json|jsonl`
   unchanged, consecutive runs byte-identical, and a non-Nest repo produces
   none of these findings.
3. As an AI agent, I read `projects[].nest` and now also see DTO properties
   (types, decorators, positions), provider public-method lists and parameter
   decorator names — enough to answer "is this field validated?" without
   parsing source — and every finding cites a rule doc I can fetch.

## Contract / Model

### Model extensions (`src/framework/nest/model.ts`, additive)

```ts
export interface NestInjectionRef {
	/** Parameter type name as written (identifier only; other types skipped). */
	name: string;
	/** True when the parameter carries @Inject(forwardRef(() => X)). */
	forwardRef: boolean;
	/** Parameter decorator names in source order, e.g. ["InjectRepository"]. */
	decoratorNames: string[];
	/** 1-based position of the parameter, adapter-resolved at extraction. */
	line: number;
	column: number;
}

export interface NestProviderEntry extends NestModelNode {
	scope: "request" | "transient" | "singleton" | null;
	injections: NestInjectionRef[];
	/**
	 * Public instance method names in source order. The constructor, static
	 * methods and the Nest lifecycle hooks (onModuleInit, onModuleDestroy,
	 * onApplicationBootstrap, beforeApplicationShutdown,
	 * onApplicationShutdown) are excluded.
	 */
	publicMethods: string[];
}

export interface NestDtoPropertyRef {
	name: string;
	/** Type annotation as written, whitespace-collapsed; null when absent. */
	typeText: string | null;
	/** Decorator names in source order (trailing identifier, `@Ns.Dec` unwrapped). */
	decoratorNames: string[];
	/** 1-based position of the property, adapter-resolved at extraction. */
	line: number;
	column: number;
}

export interface NestDtoEntry extends NestModelNode {
	via: "suffix" | "decorator";
	properties: NestDtoPropertyRef[];
}
```

`NestAppModel`, `NestModuleEntry`, `NestControllerEntry`, `NestHandlerEntry`,
`NestUnresolvedRef` are unchanged. Existing arrays keep their sort orders;
`decoratorNames`, `publicMethods`, `properties` keep source order; DTO
properties are read only for `PropertyDeclaration` members (methods,
accessors, index signatures ignored).

### Rules (all `frameworks: ["nest"]`, default severity `warn`)

| Rule id | Category | Fires at | One diagnostic per |
|---|---|---|---|
| `backend-doctor/no-business-logic-in-controller` | Architecture | the handler's method position | handler over threshold |
| `backend-doctor/no-repository-in-controller` | Architecture | the injection's parameter position | injection edge |
| `backend-doctor/no-god-service` | Maintainability | the provider's class position | provider over threshold |
| `backend-doctor/missing-global-validation-pipe` | Configuration | the `NestFactory.create*` call | bootstrap file |
| `backend-doctor/dto-field-without-validator` | Correctness | the DTO property position | unvalidated property |
| `backend-doctor/no-any-in-dto` | Maintainability | the DTO property position | `any`-typed property |

Shared semantics (spec 009 precedent): rules query `ctx.nest` and report via
stored `line`/`column` (exception: `missing-global-validation-pipe` reports at
the AST node of the `NestFactory.create*` call, engine-resolved); model
entries are filtered to `entry.filePath === ctx.file.filePath` before use;
every rule is a no-op when `ctx.nest` is absent.

Per-rule semantics:

- **no-business-logic-in-controller** — for controller entries in the scanned
  file, find each handler's method declaration in the file AST and count
  branch points in its body: `if` statements, loop statements (`for`,
  `for-of`, `for-in`, `while`, `do`), `case` clauses, conditional (ternary)
  expressions. Flag when the count is ≥ 2. Guard clauses (a single `if` that
  throws/returns early) stay silent. Logical operators (`&&`, `||`) are not
  counted.
- **no-repository-in-controller** — for controller entries in the scanned
  file, flag an injection edge when any of: `decoratorNames` contains
  `InjectRepository`; the edge type name ends with `Repository`; the type name
  is exactly `PrismaService` or `PrismaClient`. Identical injections of the
  same target in one constructor are separate edges (each its own parameter
  position).
- **no-god-service** — for provider entries in the scanned file, flag when
  `injections.length >= 6` or `publicMethods.length >= 12`; message carries
  both actual counts.
- **missing-global-validation-pipe** — when the scanned file contains a call
  `NestFactory.create(…)`, `NestFactory.createApplicationContext(…)` or
  `NestFactory.createMicroservice(…)`, report unless a global pipe is found:
  (a) the same file calls a `useGlobalPipes` member whose arguments include a
  `new ValidationPipe(…)`, or (b) any module entry in the model has
  `ValidationPipe` in its `providers` list (the `{ provide: APP_PIPE,
  useClass: ValidationPipe }` shape reads as exactly that). Fail open: no
  finding when any consulted module's providers metadata is unresolved (an
  `unresolved` entry whose reason names the `providers` list, or non-static
  module metadata) — absence of knowledge is never a finding.
- **dto-field-without-validator** — for DTO entries in the scanned file, flag
  a property when none of its `decoratorNames` falls outside the non-validator
  blacklist: `ApiProperty`, `ApiPropertyOptional`, `ApiHideProperty`, `Field`,
  `HideField`, `Expose`, `Exclude`, `Type`, `Transform`, `Column`,
  `PrimaryColumn`, `PrimaryGeneratedColumn`, `CreateDateColumn`,
  `UpdateDateColumn`, `DeleteDateColumn`, `VersionColumn`, `ObjectIdColumn`,
  `Index`, `Generated`. Every other decorator (all class-validator `Is*`,
  `Min`/`Max`/`Length`/`Matches`/`Contains`/`Equals`/`Validate*`/`Allow`/
  `Array*`, unknown custom validators) counts as a validator. A property with
  zero decorators is flagged; a property decorated only with blacklist names
  is flagged too.
- **no-any-in-dto** — for DTO entries in the scanned file, flag a property
  when its `typeText` is `any`, `any[]` or `Array<any>` (whitespace-collapsed
  comparison), or when `typeText` is `null` and the property has no
  initializer (implicit `any`). An untyped property with an initializer is
  silent (intent ambiguous).

Message templates (exact strings, snapshot-pinned):

- `no-business-logic-in-controller`: `<handler> in <Controller> carries <n>
  branch points; this reads as business logic living in the controller. Move
  the branching into a service and keep the handler a thin delegation.`
- `no-repository-in-controller`: `<Repo> is injected directly into the
  controller <Controller>; bypassing the service layer couples HTTP handling
  to storage. Inject a service that owns the repository instead.`
- `no-god-service`: `<Service> carries <d> constructor dependencies and <m>
  public methods; that breadth is a god-service smell. Split it along domain
  responsibilities into smaller providers.`
- `missing-global-validation-pipe`: `NestFactory.create is called here but no
  global ValidationPipe is registered (no useGlobalPipes(new ValidationPipe(…))
  in this file and no APP_PIPE provider in the scanned modules). Request
  bodies reach handlers unvalidated. Enable ValidationPipe globally in the
  bootstrap or provide it under the APP_PIPE token.`
- `dto-field-without-validator`: `<prop> in <Dto> has no validation decorator;
  with a global ValidationPipe it is never validated. Add a class-validator
  decorator (@IsString, @IsInt, @IsOptional, …).`
- `no-any-in-dto`: `<prop> in <Dto> is typed any; the payload shape is
  unchecked end to end. Give the field a concrete type or a nested DTO class.`
  / `…has no type annotation and no initializer, so it is implicitly any; the
  payload shape is unchecked end to end. Give the field a concrete type or a
  nested DTO class.`

## EARS acceptance criteria

**Extraction (model extensions)**

- **AC-1:** WHEN a constructor parameter of an `@Injectable`/`@Controller`
  class produces an injection edge, THE SYSTEM SHALL record the parameter's
  decorator names in source order on that edge (e.g. `["InjectRepository"]`,
  `[]` when undecorated); existing `@Optional` exclusion and `forwardRef`
  behavior SHALL NOT change.
- **AC-2:** WHEN a provider class declares public instance methods, THE SYSTEM
  SHALL record their names in source order on the provider entry, excluding
  the constructor, static/private/protected methods and the five Nest
  lifecycle hook names; WHEN the class has none, `publicMethods` SHALL be
  `[]`.
- **AC-3:** WHEN a recognized DTO class declares instance properties, THE
  SYSTEM SHALL record one entry per property with its name, type annotation
  text (`null` when absent), decorator names in source order and 1-based
  position, excluding static properties, methods and accessors; WHEN the DTO
  has no such properties, `properties` SHALL be `[]`.

**Rules**

- **AC-4:** WHEN a controller handler defined in the scanned file has ≥ 2
  branch points in its body, THE SYSTEM SHALL report exactly one
  `no-business-logic-in-controller` diagnostic (warn, Architecture) at the
  handler position with the count in the message; WHEN the handler has at
  most one branch point, or the method carries no verb decorator, THE SYSTEM
  SHALL NOT report it.
- **AC-5:** WHEN a controller constructor injection carries `@InjectRepository`,
  or its type name ends with `Repository`, or is exactly `PrismaService` or
  `PrismaClient`, THE SYSTEM SHALL report exactly one
  `no-repository-in-controller` diagnostic (warn, Architecture) at the
  parameter position; WHEN the same injection appears in a provider (not a
  controller) or matches none of the recognition forms, THE SYSTEM SHALL NOT
  report.
- **AC-6:** WHEN a provider defined in the scanned file has ≥ 6 constructor
  injections or ≥ 12 public methods, THE SYSTEM SHALL report exactly one
  `no-god-service` diagnostic (warn, Maintainability) at the class position
  with both actual counts in the message; WHEN both counts are below the
  thresholds, THE SYSTEM SHALL NOT report.
- **AC-7:** WHEN a scanned file contains a `NestFactory.create*` call and
  neither a `useGlobalPipes(new ValidationPipe(…))` call in that file nor a
  `ValidationPipe` module providers entry exists, THE SYSTEM SHALL report
  exactly one `missing-global-validation-pipe` diagnostic (warn,
  Configuration) at the create call; WHEN a global pipe is found by either
  path, no `NestFactory.create*` call exists, or any consulted module's
  providers metadata is unresolved, THE SYSTEM SHALL NOT report.
- **AC-8:** WHEN a DTO property defined in the scanned file carries no
  decorator outside the non-validator blacklist (including zero decorators),
  THE SYSTEM SHALL report exactly one `dto-field-without-validator` diagnostic
  (warn, Correctness) at the property position; WHEN any decorator outside the
  blacklist is present, THE SYSTEM SHALL NOT report.
- **AC-9:** WHEN a DTO property's type annotation is `any`, `any[]` or
  `Array<any>`, or it has neither annotation nor initializer, THE SYSTEM SHALL
  report exactly one `no-any-in-dto` diagnostic (warn, Maintainability) at the
  property position with the matching message variant; WHEN the property has a
  concrete annotation, or is untyped but initialized, THE SYSTEM SHALL NOT
  report.
- **AC-10:** WHEN the scanned file defines none of the pack's triggers
  (no controller/provider/DTO entries or no bootstrap call), THE SYSTEM SHALL
  produce no diagnostics from this pack for that file.
- **AC-11:** WHEN nest is not among the detected frameworks, or the model is
  absent because extraction failed, THE SYSTEM SHALL produce no pack
  diagnostics, keep the `nest-app-model` skippedCheck visible in the latter
  case, and complete the scan with unchanged exit codes.
- **AC-12:** WHEN the same Nest tree is scanned twice, THE SYSTEM SHALL
  produce byte-identical JSON reports (diagnostics and the extended
  `projects[].nest`).
- **AC-13:** WHEN config sets a pack rule to `"off"` THE SYSTEM SHALL produce
  no diagnostics for it, and WHEN set to `"error"` THE SYSTEM SHALL escalate
  its severity (exit code 1 when such diagnostics exist).
- **AC-14:** WHEN the feature ships, every pack rule SHALL have `valid/` and
  `invalid/` fixtures, snapshot tests of the exact diagnostics, and a markdown
  doc at `docs/rules/<rule-id>.md` (constitution §3).

## Testing strategy (TDD)

- **Fixtures** `tests/fixtures/nest/layers-dto/<short-name>/{valid,invalid}/`
  — multi-file mini-apps (the spec 009 precedent; deviation from constitution
  §3's flat `tests/fixtures/<rule-id>/` layout is deliberate — Nest rules need
  module/controller/DTO context). Planned trees:
  - `controller-logic/invalid/` — a controller with a handler holding 2 `if`s
    and one holding a `for`-of loop; `valid/` — single guard-clause handler,
    a trivial delegation handler, a non-verb helper method (AC-4).
  - `controller-repository/invalid/` — controller injecting
    `@InjectRepository(UserEntity)`, a `UsersRepository`-named class, and
    `PrismaService`; `valid/` — the same repositories injected into
    `UsersService` instead (AC-5).
  - `god-service/invalid/` — a provider with 6 injections; `valid/` — 5
    injections (AC-6). The 12-method threshold is exercised in unit tests on
    a temp file (no committed fixture needed).
  - `validation-pipe/invalid/` — `main.ts` calling `NestFactory.create`
    without any pipe + `app.module.ts` without `ValidationPipe`; `valid/` —
    the same bootstrap with `app.useGlobalPipes(new ValidationPipe(…))` and an
    APP_PIPE-provider variant (AC-7).
  - `dto-fields/invalid/` — DTO with a bare property, an `@ApiProperty()`-only
    property, an `any`-typed, an `any[]`-typed and an untyped-uninitialized
    property; `valid/` — `@IsString`/`@IsOptional`/`@ValidateNested`
    properties, a concrete-typed property, an untyped-initialized property,
    `@Allow()` (AC-8, AC-9).
  - `model-extensions/` — one app exercising param decorator names, lifecycle
    hook exclusion, static/`any`/untyped DTO properties (AC-1..3).
- **Unit** — new `tests/unit/rules/layers-dto.test.ts` reusing the
  `scanNestFixture` pattern from `tests/unit/rules/nest-di.test.ts` (real
  `TsMorphParserAdapter`, model built once, `runRules` per file,
  `detectedFrameworks: ["nest"]`); assert exact diagnostics — file, line,
  column, message, severity, category; positions pinned by printing real
  coordinates on first failure (spec 007/009 precedent). Extend
  `tests/unit/framework/nest-model.test.ts` for AC-1..3. Update the
  registry-count assertion in `tests/unit/rules/blocking.test.ts` (20 → 26).
- **Integration** — extend `tests/integration/scan.test.ts`: a staged Nest
  tree produces pack diagnostics through the full pipeline (`runScan` builds
  the model); a non-nest tree produces none (AC-11).
- **e2e** — new `tests/e2e/layers-dto-rules.test.ts` via `runCli`/`makeTmpDir`:
  JSON diagnostics from the built bin for a god-service and a
  missing-ValidationPipe tree; determinism (two runs byte-identical, AC-12);
  severity override `off`/`error` incl. exit code 1 (AC-13); jsonl stays
  diagnostics-only; stdout-only report purity via `expectSuccess`.
- **Docs** — six rule docs under `docs/rules/backend-doctor/` (AC-14), in the
  existing format (Problem / Bad / Good / Scope notes / Configuration); unit
  assertions check each shipped rule's `docs` path exists on disk (no
  generation script yet — F017/F023 own that). New ts-morph facts discovered
  while probing (property decorators, `getScope()`, initializer checks) go to
  `docs/RESEARCH.md` per the deviations discipline.
- **Adapter growth** — `parser/types.ts` grows only type-only re-exports
  (`PropertyDeclaration`, `IfStatement`, `ForStatement`, `ForOfStatement`,
  `ForInStatement`, `WhileStatement`, `DoStatement`, `SwitchStatement`,
  `CaseClause`, `ConditionalExpression`) per the established precedent
  (constitution §4).

## Open questions for review

1. **The business-logic heuristic and its threshold.** Recommendation: the
   branch-point count as specced (if + loops + `case` clauses + ternaries,
   flag at ≥ 2, guard clauses silent) — it is deterministic, cheap, and the
   single-`if` exemption keeps the common input-normalization handler clean;
   the alternative — flagging only handlers that never call an injected
   member — reads as more precise but is brittle without type information
   (helpers called through `this` vs imports) and misses mixed handlers that
   delegate *and* branch. Second alternative: threshold ≥ 3 (quieter, misses
   the canonical two-`if` validation-in-controller case).
2. **The repository recognition set.** Recommendation: `@InjectRepository`
   decorator + type name ending `Repository` + exact `PrismaService` /
   `PrismaClient` — three cheap forms with near-zero FP surface; the
   alternative (decorator-only) is maximal precision but misses the majority
   of real-world controllers that inject plain `*Repository` classes.
3. **Expose the new model fields in the JSON report?** `decoratorNames`,
   `publicMethods`, DTO `properties` appear in `projects[].nest`.
   Recommendation: yes — serialize the model as-is (additive under
   constitution §5, no `schemaVersion` bump; identical to the spec 009
   resolution); the alternative — a projection layer stripping rules-only
   fields — was already rejected in spec 009.
4. **New dependencies.** Recommendation: none — the class-validator /
   class-transformer / TypeORM decorator vocabularies are hardcoded name
   lists (deterministic, no runtime imports); everything else reuses the
   existing traversal vocabulary. Alternative: none identified.
