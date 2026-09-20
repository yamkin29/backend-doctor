# Spec 008 — Nest app model (F008)

- **Status:** Approved (2026-09-20)
- **Phase:** 2 — Nest specifics & Prisma
- **Depends on:** F003 (Engine core) — Done (`SourceFileView` traversal, adapter,
  runner); F004 (Framework detection) — Done (`nest` id, pack gate, `getModuleSpecifiers`)
- **Blocks:** F009 (DI rules), F010 (Layers & DTO), F011 (Errors & lifecycle),
  F012 (Prisma rules consume controller/handler positions), F022 (eval corpus
  needs a real Nest app model to keep the FP budget honest)

## Resolution (recorded at approval, 2026-09-20)

The user approved the spec as recommended. All open questions resolved as
recommended: (1) the model is exposed in the JSON report as optional
`projects[].nest` (additive, no `schemaVersion` bump); (2) DTO detection is
name suffix `Dto`/`DTO` plus the pinned decorator list; (3) no new
dependencies.

One design-time refinement, recorded before implementation: the `@nestjs/`
file gate applies to **decorator-derived** entries only; suffix DTOs are
collected from every analyzed file, because a plain `*.dto.ts` usually imports
only `class-validator` and gating it would drop the commonest DTO shape
(unreachable AC-4). The gate bullet and AC-6 below already carry this wording.

## Problem

All sixteen shipped rules are framework-agnostic and see one file at a time. The
Nest packs (F009–F011) cannot be written this way: "provider not registered in
any module", "controller reaching into a repository", "missing global
ValidationPipe" are questions about the application structure — which class is a
module, which modules import it, what a controller serves, which classes are
DTOs. The answers live in decorators spread across files, and nothing in the
engine today extracts them. F008 builds that extraction once: a deterministic
Nest application model (modules, providers, controllers, DTOs) produced during
`runScan` and handed to every future Nest rule. Per the PLAN line it ships **no
rules** — it is the foundation the next three features consume.

## Goals

- An extraction pass over the already-parsed files that produces a
  `NestAppModel`: `modules`, `controllers` (with route + HTTP handler methods),
  `providers`, `dtos`, and an `unresolved` list for decorator shapes the
  extractor cannot read statically (constitution §8 — fail soft, report loud).
- Precision gates (constitution §2): a file contributes entries only when it
  references a `@nestjs/` module specifier; provider and controller entries
  require their exact decorator names (`@Injectable`, `@Controller`).
- Determinism (constitution §1): model arrays are sorted by stable keys;
  reference lists keep source order; two scans of the same tree produce
  byte-identical models.
- Pipeline integration: `runScan` builds the model once when `nest` is among
  the detected frameworks; rules receive it through an additive optional
  `nest` field on `RuleContext`; the JSON report exposes it as an optional
  `projects[].nest` block (open question 1).
- Extraction runs through the `SourceFileView` + `parser/types.ts` vocabulary —
  type-only re-export growth, no new runtime adapter methods, no new
  dependencies (constitution §4).
- Unchanged contracts: `schemaVersion` stays 1, exit codes stay 0/1/2, the
  pretty reporter and jsonl are untouched, no config fields are added, and no
  rules ship (so no rule docs — constitution §3 does not apply to this feature).

## Non-goals

- Any new diagnostic or rule (F009/F010/F011 own the first Nest rules); no rule
  docs, no fixtures under `tests/fixtures/backend-doctor/`.
- Import resolution across files (F013's graph): cross-file references are
  matched by class **name** as written in decorator arrays; module specifiers
  are not resolved to files. Aliased/dynamic references stay name-only.
- Deep custom-provider modeling: `useFactory` bodies, `useValue` tokens and
  factory parameter deps are recorded as `unresolved` entries (with `useClass`/
  `useExisting` identifier values as the one statically readable exception) —
  F009 refines if its rules need more.
- Typechecker information (type-aware DI, generic type args) — the engine stays
  syntax-only (spec 003 scope; Engine v2 migration untouched).
- Express/Fastify/Prisma application models — decorators are a Nest concept;
  those packs do not need one (F012 consumes positions only).
- Bootstrap code (`main.ts`, `NestFactory`), `@Global`, `@Catch`, middleware,
  guards/pipes/interceptors as *distinguished* kinds — an `@Injectable`-decorated
  guard is a provider like any other; F009–F011 refine if needed.
- Multi-project/monorepo modeling — `projects[]` stays single-entry (F003/F004
  semantics; a new PLAN line would be needed first).
- Pretty-reporter changes; new CLI flags or config fields.

## User stories

1. As a backend developer, I run `backend-doctor scan .` on my Nest app and see
   the same report surface as before (no new rules yet); the scan now knows my
   module/provider/controller structure, so the next release's Nest rules will
   fire without any config change from me.
2. As a CI author, my exit codes and formats are unchanged; the JSON report
   gains one optional `projects[].nest` block (only for Nest projects) that I
   can branch on, and consecutive runs stay byte-identical.
3. As an AI agent, I read `projects[].nest` from a single scan to get the app
   map — which modules exist, what each provides, which controllers serve which
   routes — and it is stable across runs, so I can diff structure between
   commits the same way I diff diagnostics.

## Contract / Model

### Types (new module `src/framework/nest/model.ts`)

```ts
export type NestHttpVerb =
	| "get" | "post" | "put" | "patch"
	| "delete" | "options" | "head" | "all";

/** Common fields; positions are adapter-resolved, 1-based, at the class start. */
export interface NestModelNode {
	/** Absolute path of the defining file (same convention as Diagnostic.filePath). */
	filePath: string;
	className: string;
	line: number;
	column: number;
}

export interface NestModuleEntry extends NestModelNode {
	/** Referenced class names, in source order, as written. */
	imports: string[];
	providers: string[];
	controllers: string[];
	exports: string[];
}

export interface NestHandlerEntry {
	name: string;
	verb: NestHttpVerb;
	/** First string-literal argument of the verb decorator; null when absent. */
	path: string | null;
	line: number;
	column: number;
}

export interface NestControllerEntry extends NestModelNode {
	/** First string-literal argument of @Controller; null when absent. */
	route: string | null;
	handlers: NestHandlerEntry[];
}

export interface NestProviderEntry extends NestModelNode {}

export interface NestDtoEntry extends NestModelNode {
	/** How the class was recognized (open question 2). */
	via: "suffix" | "decorator";
}

export interface NestUnresolvedRef {
	filePath: string;
	line: number;
	column: number;
	/** Stable human-readable reason, e.g. "spread element in providers array". */
	reason: string;
}

export interface NestAppModel {
	modules: NestModuleEntry[];
	controllers: NestControllerEntry[];
	providers: NestProviderEntry[];
	dtos: NestDtoEntry[];
	unresolved: NestUnresolvedRef[];
}
```

### Extraction rules

- **File gate:** decorator-derived entries (modules, controllers, providers,
  decorator-DTOs) are collected only from files whose `getModuleSpecifiers()`
  contain a specifier starting with `@nestjs/` (same prefix style as
  `FRAMEWORK_MARKERS`). Decorators from user code or other frameworks never
  enter the model. Suffix DTOs are exempt from the gate (resolution above).
  Recall holes (documented): decorators re-exported through a local module are
  missed; a non-Nest class coincidentally named `*Dto` inside a Nest project
  enters the model.
- **Modules:** class decorated `@Module` whose first argument is an object
  literal. Properties `imports`, `providers`, `controllers`, `exports` are read
  as arrays of identifiers (verbatim names, source order). In `providers`
  (and `imports`/`exports`), an object literal element contributes its
  `useClass`/`useExisting` identifier value as a provider reference when
  present. Everything else non-identifier (spread, computed, call results,
  `useFactory`, string tokens) yields one `unresolved` entry per offending
  element — statically readable siblings are kept.
- **Controllers:** class decorated `@Controller`; `route` is the first
  string-literal argument (null when the decorator has none). A method is a
  handler when it carries one of the `NestHttpVerb` decorators (trailing
  identifier match, lowercased); `path` is its first string-literal argument.
  Handlers keep source order.
- **Providers:** class decorated `@Injectable`. Guards, pipes, interceptors and
  filters decorated `@Injectable` land here by design (Nest makes no
  distinction); legacy `@Component` is not matched (documented recall hole).
- **DTOs** (open question 2): class name ending with `Dto` or `DTO` (case
  exact), or the class decorated with `InputType`/`ArgsType`/`ObjectType`/
  `PartialType`/`PickType`/`OmitType`/`IntersectionType`.
- **Anonymous classes** (`export default class { … }` with a decorator) are
  skipped — they cannot be referenced by name; documented recall hole.
- **Sorting:** `modules`/`controllers`/`providers`/`dtos` sorted by
  `(filePath, className)`; `unresolved` sorted by `(filePath, line, column)`.
  Reference arrays and handler lists keep source order (deterministic as
  written).

### Pipeline and contracts

- **Extractor** (new `src/framework/nest/extract.ts`):
  `extractNestAppModel(files: readonly SourceFileView[], adapter: ParserAdapter):
  NestAppModel` — pure, deterministic, never throws for per-decorator problems
  (those become `unresolved` entries); only a program-level bug can throw.
- **`runScan`** (`src/core/scan.ts`): after framework detection, WHEN `nest` is
  detected, build the model once inside a try/catch; a crash records
  `skippedChecks: [{ check: "nest-app-model", reason }]` and leaves the model
  absent (constitution §8).
- **`ProjectInfo`** (`src/core/types.ts`) grows an optional field
  `nest?: NestAppModel` — present only when the model was built. This is
  additive (constitution §5): `schemaVersion` stays 1, non-Nest reports are
  byte-identical to today's output.
- **`RuleContext`** (`src/engine/parser/types.ts`) grows an optional field
  `nest?: NestAppModel` so F009+ rules can query the model; rules that ignore
  it are unaffected. `parser/types.ts` imports the model types type-only.
- **`parser/types.ts`** grows type-only re-exports for the AST vocabulary the
  extractor needs (at least `ClassDeclaration`, `Decorator`, `MethodDeclaration`,
  `ObjectLiteralExpression`, `PropertyAssignment`, `ArrayLiteralExpression`,
  `StringLiteral`) — the established spec 007 precedent; the adapter itself
  needs no new runtime members.
- Pretty and jsonl reporters are untouched; the JSON reporter serializes the
  report document as-is, so `projects[].nest` appears automatically.
- No new rules registered; `src/rules/index.ts` unchanged; registry count
  assertions stay at 16.

## EARS acceptance criteria

**Extraction**

- **AC-1:** WHEN a file referencing a `@nestjs/` specifier defines a class
  decorated `@Module` with a static object-literal argument, THE SYSTEM SHALL
  produce exactly one module entry carrying the class name, file path, 1-based
  line/column, and the four reference lists as written (identifiers verbatim;
  `useClass`/`useExisting` identifier values included for providers).
- **AC-2:** WHEN a class is decorated `@Controller` (with or without a string
  route), THE SYSTEM SHALL produce a controller entry whose `route` is the
  first string literal or null, with one handler per verb-decorated method
  carrying the lowercased verb, its first string-literal path or null, and the
  method position.
- **AC-3:** WHEN a class is decorated `@Injectable`, THE SYSTEM SHALL produce
  exactly one provider entry at the class position.
- **AC-4:** WHEN a class name ends with `Dto`/`DTO` or carries one of the
  pinned DTO decorators, THE SYSTEM SHALL produce a DTO entry with the matching
  `via`; WHEN neither holds, THE SYSTEM SHALL NOT produce a DTO entry (an
  `@Injectable` service named `UsersService` stays provider-only).
- **AC-5:** WHEN a `@Module` metadata element cannot be read statically (spread
  element, non-identifier non-`useClass` element such as a `useFactory` call,
  first argument not an object literal), THE SYSTEM SHALL record one
  `unresolved` entry with file/line/column and a stable reason, and SHALL keep
  every statically readable sibling entry.
- **AC-6:** WHEN a file references no `@nestjs/` module specifier (including a
  file declaring its own `@Module` decorator), THE SYSTEM SHALL collect no
  decorator-derived entries from it (suffix-DTO classes remain collectible per
  the gate rule).

**Pipeline**

- **AC-7:** WHEN nest is among the detected frameworks, `runScan` SHALL build
  the model and expose it on the result and at `projects[0].nest` in the JSON
  report; WHEN nest is not detected, `projects[0]` SHALL have no `nest` field
  and the JSON SHALL be byte-identical to the pre-F008 output for the same
  tree.
- **AC-8:** WHEN the same Nest tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports including `projects[0].nest` (sorted arrays,
  stable reasons).
- **AC-9:** WHEN the extractor throws, `runScan` SHALL record a
  `skippedChecks` entry with `check: "nest-app-model"`, leave `nest` absent,
  and complete the scan without failing (exit codes unchanged).
- **AC-10:** WHEN a nest-flagged tree contains no Nest decorators, THE SYSTEM
  SHALL expose a model whose five arrays are all empty (never undefined).
- **AC-11:** WHEN rules run during a nest scan, every `RuleContext` SHALL carry
  the same model via the optional `nest` field; rules that do not read it SHALL
  be unaffected (no new diagnostics anywhere).

## Testing strategy (TDD)

- **Fixtures** `tests/fixtures/nest/model-app/` (committed; new fixture root —
  this feature ships no rules, so the `backend-doctor/<rule-id>` layout does
  not apply):
  - `app.module.ts` — `@Module({ imports: [UsersModule], controllers:
    [UsersController], providers: [UsersService] })`;
  - `users/users.module.ts` — `@Module({ providers: [UsersService,
    { provide: TOKEN, useClass: UsersService }, { provide: FACTORY, useFactory:
    makeService }], exports: [UsersService] })` (covers `useClass` capture and
    two `unresolved` shapes);
  - `users/users.controller.ts` — `@Controller('users')` with `@Get()`,
    `@Get(':id')`, `@Post()` handlers and one undecorated method;
  - `users/users.service.ts` — `@Injectable()`;
  - `users/create-user.dto.ts` — plain class `CreateUserDto` (via suffix);
  - `users/user.dto.ts` — class `UserFilter` decorated `@InputType()` (via
    decorator, negative for suffix);
  - `plain/plain.service.ts` — same-file own `@Injectable` decorator, no
    `@nestjs/` import (AC-6 negative).
- **Unit** `tests/unit/framework/nest-model.test.ts` (new) — run
  `extractNestAppModel` over the fixture set with the real
  `TsMorphParserAdapter`; assert the full model with `toEqual` (AC-1..6,
  AC-10 shape over an empty dir), exact positions pinned the spec 007 way
  (print real coordinates on first failure).
- **Integration** `tests/integration/scan.test.ts` (extend) — stage a temp
  Nest tree (existing `frameworks → ["nest"]` staging precedent): assert
  `result.projects[0].nest` counts and a stable sort; a non-nest temp tree
  asserts `nest` is absent (`"nest" in projects[0]` is false); call the
  internal build step with a throwing fake extractor to pin the
  `skippedChecks` entry (AC-9) at the engine level.
- **e2e** `tests/e2e/nest-model.test.ts` (new; temp trees via
  `runCli`/`makeTmpDir`) — JSON from the real bin carries the expected
  `projects[0].nest` names; a non-nest tree has no `nest` key and its JSON is
  unchanged in shape; two consecutive scans are byte-identical (AC-7, AC-8);
  jsonl stays diagnostics-only (regression).
- **Docs** — no rule docs (no rules). `docs/RESEARCH.md` gains the ts-morph
  decorator-API facts probed during TDD (the `Decorator.getName()` prototype
  question), per the deviations discipline.
- **No new dependencies** (open question 3); no committed fixtures beyond
  `tests/fixtures/nest/`; existing pinned reports untouched.

## Open questions for review

1. **Expose the model in the JSON report?** Recommendation: yes — optional
   `projects[].nest` as specified (additive under constitution §5, no
   `schemaVersion` bump; gives F008 an observable end-to-end contract and
   agents a stable app map). Alternative: keep the model internal until F009
   ships rules — then F008 alone has no CLI-visible behavior and its ACs stop
   at the `runScan` result. The report field is contract surface — user-owned.
2. **DTO detection strategy.** Recommendation: name suffix `Dto`/`DTO` plus the
   pinned decorator list (`InputType`/`ArgsType`/`ObjectType`/`PartialType`/
   `PickType`/`OmitType`/`IntersectionType`) — deterministic, zero extra
   gates, covers the Nest CLI naming convention and the mapped-types/GraphQL
   styles. Alternative: also classes decorated with `class-validator` decorators
   (`@IsString()` on every field) — more recall, but a second dependency gate
   to pin and more surface to keep precise; F010 can extend `via` additively
   when its DTO-field rules need it.
3. **New dependencies.** Recommendation: none — the extractor needs only the
   existing traversal vocabulary plus type-only re-exports, positions come
   from the existing adapter. Alternative: none identified.
