# Spec 009 — Nest DI rules (F009)

- **Status:** Approved (2026-09-20)
- **Phase:** 2 — Nest specifics & Prisma
- **Depends on:** F008 (Nest app model) — Done (model, `RuleContext.nest`, pack
  gate, `nest-app-model` skippedCheck); F003 (engine core) — Done; F004
  (framework detection) — Done
- **Blocks:** F010/F011 (reuse the injection and scope data this feature adds to
  the model), F022 (eval corpus consumes the DI rules)

## Resolution (recorded at approval, 2026-09-20)

The user approved the spec as recommended. All open questions resolved as
recommended: (1) the extended model fields are exposed in `projects[].nest`
(additive, no `schemaVersion` bump); (2) **no** rule ships for the
"blocking constructor work" PLAN bullet — F005/F006 already cover constructor
bodies, the onModuleInit angle is F011's line; (3) on a forwardRef-less cycle
both `circular-di` and `missing-forward-ref` fire (distinct positions and
messages); (4) no new dependencies.

## Problem

F008 shipped the Nest application model but deliberately no rules. The model
today knows modules, controllers, providers and DTOs — but not how classes are
wired together: it records neither constructor injections, nor provider scopes,
nor `@Global` modules, nor whether a module's metadata could be read at all.
The four DI failure modes the PLAN line names — a provider injected but never
registered, a circular dependency, a request-scoped provider pulled into a
singleton, a cycle missing `forwardRef` — are invisible. All four crash or
degrade a Nest app at bootstrap or per request, and none is detectable by the
sixteen shipped framework-agnostic rules. F009 extends the model with exactly
the wiring data its rules need and ships the first Nest-gated rule pack on top.

## Goals

- Four new rules, all gated `frameworks: ["nest"]`, all default `warn`
  (constitution §2):
  - `backend-doctor/provider-not-registered` (Correctness) — a constructor
    injection of a known provider class that none of the consumer's owning
    modules provides or imports (directly, transitively via exports, or from a
    `@Global` module).
  - `backend-doctor/circular-di` (Architecture) — one diagnostic per provider
    dependency cycle (strongly connected component or self-loop), reported at a
    deterministic canonical member, message containing the cycle path.
  - `backend-doctor/missing-forward-ref` (Correctness) — a cycle in which no
    injection edge uses `forwardRef()`; one diagnostic at the closing edge's
    parameter, because Nest cannot construct such a cycle at bootstrap.
  - `backend-doctor/request-scoped-in-singleton` (Performance) — a
    request-scoped provider injected into a default-scope (singleton) consumer,
    which silently makes the consumer and its subtree per-request.
- Model extensions (additive to F008, sanctioned by its non-goal "F009 refines
  if its rules need more"): constructor `injections` on provider and controller
  entries (name, `forwardRef` flag, position; `@Optional` excluded), `scope` on
  provider entries (`Scope.REQUEST`/`"request"` and siblings), `global` and
  `hasUnresolved` flags on module entries, and `module` key capture for
  DynamicModule literals in reference arrays.
- Fail-open precision gates (constitution §2): an injection is never flagged
  when any consulted module has unresolved metadata, when a referenced module
  or provider class is absent from the model, or when the consumer has no
  owning module. Absence of knowledge never becomes a finding.
- Determinism (constitution §1): every rule output is derived from the sorted
  model plus the file under scan; cycle enumeration and messages are computed
  by a fixed lexicographic procedure; two scans are byte-identical.
- Unchanged contracts: `schemaVersion` stays 1, exit codes stay 0/1/2, no new
  CLI flags or config fields, pretty/jsonl reporters untouched. The JSON
  report's `projects[].nest` grows the new fields (open question 1 — additive
  under constitution §5).

## Non-goals

- Import-path resolution, tsconfig paths and aliasing: injections and module
  references are matched by class **name** as written; duplicate class names
  across files alias (documented precision caveat). File-level import graph
  resolution belongs to F013 (graph rules).
- Type-aware DI (constructor param types via the checker, generic providers,
  `ModuleRef`/property injection) — the engine stays syntax-only (spec 003).
- Deeper custom-provider modeling: `useFactory` parameter deps, `useValue`
  tokens, string injection tokens, `inject: [...]` arrays stay `unresolved`
  (F008 non-goal stands); rules fail open on them.
- `@Global` via `isGlobal: true` inside a DynamicModule literal returned by
  `forRoot()`/`forRootAsync()` — not captured (recall hole, documented); only
  the `@Global` class decorator is.
- `@Self()`/`@SkipSelf()` resolution semantics — such edges are treated as
  ordinary injections (documented hole); only `@Optional` is excluded.
- A "blocking constructor work" rule (PLAN bullet 4) — open question 2
  recommends not shipping one here; F005/F006 rules already cover constructor
  bodies framework-agnostically, and the onModuleInit angle belongs to F011
  ("heavy work in constructor instead of `onModuleInit`").
- Lifecycle advice (`onModuleInit`/`onModuleDestroy`), layers/DTO rules,
  Prisma rules — F011/F010/F012.
- Multi-project/monorepo modeling; `projects[]` stays single-entry.
- New dependencies, CLI flags, config fields; exit-code or `schemaVersion`
  changes; reporter changes.

## User stories

1. As a backend developer, I run `backend-doctor scan .` on my Nest app and get
   warnings at the exact constructor parameter or class that would break at
   bootstrap (unregistered provider, forwardRef-less cycle) or silently cost
   per request (request-scoped injected into a singleton) — without giving up
   false-positive safety on `forRoot()`/`useFactory` patterns the analyzer
   cannot fully read.
2. As a CI author, the DI rules behave like every other rule: `warn` by default
   so they never flip exit code 1 until I promote them, `--format json` and
   jsonl unchanged, and consecutive runs byte-identical.
3. As an AI agent, I read `projects[].nest` and now also see the wiring — who
   injects whom, provider scopes, which modules are global and which metadata
   was unreadable — in a stable, sorted shape I can diff between commits, and
   each finding cites a rule doc I can fetch.

## Contract / Model

### Model extensions (`src/framework/nest/model.ts`, additive)

```ts
/** One constructor DI edge of a provider or controller class. */
export interface NestInjectionRef {
	/** Parameter type name as written (identifier only; primitives excluded). */
	name: string;
	/** True when the parameter carries @Inject(forwardRef(() => X)). */
	forwardRef: boolean;
	/** 1-based position of the parameter (adapter-resolved at extraction). */
	line: number;
	column: number;
}

export interface NestModuleEntry extends NestModelNode {
	imports: string[];
	providers: string[];
	controllers: string[];
	exports: string[];
	/** True when any metadata list of this module produced an unresolved entry. */
	hasUnresolved: boolean;
	/** The class carries a @Global decorator. */
	global: boolean;
}

export interface NestProviderEntry extends NestModelNode {
	/** Decorator scope: "request" | "transient" | "singleton"; null when
	 *  absent or not statically readable. */
	scope: "request" | "transient" | "singleton" | null;
	/** Constructor DI edges in source order. */
	injections: NestInjectionRef[];
}

export interface NestControllerEntry extends NestModelNode {
	route: string | null;
	handlers: NestHandlerEntry[];
	/** Constructor DI edges in source order. */
	injections: NestInjectionRef[];
}
```

`NestAppModel`, `NestDtoEntry`, `NestUnresolvedRef`, `NestHandlerEntry` are
unchanged. Existing arrays keep their sort orders; `injections` keep parameter
(source) order; new scalar fields do not affect sorting.

### Extraction refinements (`src/framework/nest/extract.ts`)

- **Injections:** for every `@Injectable`/`@Controller` class, each constructor
  parameter contributes an edge when its type node is a plain identifier
  (primitive keywords and non-identifier types are skipped) and it lacks an
  `@Optional` parameter decorator. `forwardRef` is true only for
  `@Inject(forwardRef(() => X))`. Positions are the parameter's adapter-resolved
  1-based line/column (decorated parameters position at the leading `@`, the
  spec 008 decorator precedent).
- **Scope:** read from the first `@Injectable` call argument's object-literal
  `scope` property: `Scope.REQUEST`/`"request"` → `"request"`,
  `Scope.TRANSIENT`/`"transient"`, `Scope.DEFAULT`/`"singleton"`. Anything else
  (absent, computed, imported const) → `null`.
- **Modules:** `global: true` when the class also carries a `@Global`
  decorator. `hasUnresolved: true` when any of the four lists of this module
  yielded an `unresolved` entry, or the metadata is not a static object literal.
- **Reference arrays:** an object-literal element additionally contributes its
  `module` property identifier (DynamicModule literals, `imports`), alongside
  the existing `useClass`/`useExisting` capture.

### Rules (all `frameworks: ["nest"]`, default severity `warn`)

| Rule id | Category | Fires at | One diagnostic per |
|---|---|---|---|
| `backend-doctor/provider-not-registered` | Correctness | the unresolvable injection's parameter position | injection edge |
| `backend-doctor/circular-di` | Architecture | the canonical member's class position | strongly connected component / self-loop |
| `backend-doctor/missing-forward-ref` | Correctness | the closing edge's parameter position | forwardRef-less component |
| `backend-doctor/request-scoped-in-singleton` | Performance | the injection's parameter position | injection edge |

Resolution semantics shared by `provider-not-registered`:

- Consumers are provider and controller entries defined in the file under scan
  (`entry.filePath === ctx.file.filePath`); a consumer's owning modules are the
  modules whose `providers` or `controllers` arrays contain its class name.
  A consumer with no owning module is never flagged.
- Provider `P` (an injection name that matches at least one provider entry —
  otherwise the edge is skipped as a non-class token) is resolvable from
  module `M` when: `P ∈ M.providers`; or some module on `M`'s transitive
  `imports` (name-matched, cycle-safe) exports `P`; or any `@Global` module
  exports `P`. An import name with no model entry is treated as potentially
  exporting anything (fail open). The injection is flagged only when it is
  unresolvable from **every** owning module (keeps one diagnostic per edge and
  deterministic ids).
- Fail open (no finding) whenever any consulted module has `hasUnresolved`,
  or the model is absent (`ctx.nest === undefined` — the extraction-crash path;
  the `nest-app-model` skippedCheck keeps that visible per constitution §8).

Cycle machinery shared by `circular-di`/`missing-forward-ref`:

- Nodes are provider entries keyed by `(filePath, className)`; edges are
  injection names matching provider class names (name-matched). Components are
  computed over the model-sorted node order (Tarjan); each component with size
  > 1 or a self-loop yields one deterministic simple cycle: a lexicographic
  DFS from the canonical member (smallest `(filePath, className)`) always
  following the alphabetically smallest injected name, first path back to the
  canonical member. The path is rendered `A → B → A`.
- `circular-di` message: `Providers form a circular dependency: <path>.
  Restructure so dependencies flow one way (extract a shared third provider); a
  truly mutual pair needs forwardRef() on both sides.`
- `missing-forward-ref` fires only when **no** edge of the cycle has
  `forwardRef: true`, at the closing edge's parameter (the edge whose target is
  the canonical member): `The injection cycle <path> uses no forwardRef(), so
  Nest cannot construct these providers and fails at bootstrap with a
  circular-dependency error. Wrap the type in forwardRef(() => X) on both sides
  or restructure.` When at least one edge uses `forwardRef`, this rule is
  silent for that cycle (open question 3 covers the resulting overlap).
- `provider-not-registered` message: `<P> is injected here but none of the
  modules registering <C> provide or export it (directly or via imports);
  Nest fails to resolve this dependency at bootstrap. Add <P> to a providers
  array or import a module that provides it.` (`P` = injected class name,
  `C` = consumer class name.)
- `request-scoped-in-singleton` message: `<P> is request-scoped; injecting it
  into the singleton <C> makes <C> and its subtree rebuild on every request.
  Keep request state out of DI scope (pass it per call) or accept the
  per-request cost explicitly.` Fires when the target provider's recorded scope
  is `"request"` and the consumer is a provider with `scope` `null` or
  `"singleton"` (controllers are singleton by default; a `"transient"` consumer
  is a documented recall hole).

Rules report via the stored `line`/`column` of model entries (`ReportInput`
fallback positions) — no rule touches AST nodes; the F008 model boundary holds
(constitution §4). Every rule is a no-op when `ctx.nest` is absent.

## EARS acceptance criteria

**Extraction (model extensions)**

- **AC-1:** WHEN a provider carries `@Injectable({ scope: Scope.REQUEST })`
  (or the string-literal / `Scope.DEFAULT` / `Scope.TRANSIENT` equivalents),
  THE SYSTEM SHALL record the mapped `"request"`/`"singleton"`/`"transient"` on
  its entry; WHEN the scope is absent or not statically readable, `scope` SHALL
  be `null`.
- **AC-2:** WHEN an `@Injectable`/`@Controller` class has a constructor with
  identifier-typed parameters, THE SYSTEM SHALL record one injection per
  non-`@Optional` parameter in source order carrying the type name, the
  `forwardRef` flag (true only for `@Inject(forwardRef(() => X))`) and the
  1-based parameter position; WHEN the class has no constructor or no readable
  parameters, `injections` SHALL be `[]`.
- **AC-3:** WHEN a module class carries `@Global`, THE SYSTEM SHALL record
  `global: true`; otherwise `false`.
- **AC-4:** WHEN any metadata list of a module yields an `unresolved` entry
  (or its metadata is not a static object literal), THE SYSTEM SHALL set
  `hasUnresolved: true` on that module entry and still record the unresolved
  entry itself.
- **AC-5:** WHEN a reference-array element is the object literal
  `{ module: SomeModule }`, THE SYSTEM SHALL include `SomeModule` in the
  reference list (in addition to the existing `useClass`/`useExisting`
  capture).

**Rules**

- **AC-6:** WHEN a consumer class defined in the scanned file injects a known
  provider `P` that none of its owning modules provides or exports (directly,
  transitively, or via a `@Global` module), THE SYSTEM SHALL report exactly one
  `provider-not-registered` diagnostic (warn, Correctness) at the parameter
  position with the message template above.
- **AC-7:** WHEN the injected name is not a known provider class, the consumer
  has no owning module, the parameter is `@Optional`, the provider is
  resolvable from at least one owning module, a referenced module has no model
  entry, or any consulted module has `hasUnresolved`, THE SYSTEM SHALL NOT
  report `provider-not-registered`.
- **AC-8:** WHEN the provider injection graph contains a cycle, THE SYSTEM
  SHALL report exactly one `circular-di` diagnostic (warn, Architecture) per
  cyclic component at the canonical member's class position, with the message
  containing the deterministic `A → B → A` path; WHEN the scanned file does not
  define a component's canonical member, THE SYSTEM SHALL NOT report that
  component in that file.
- **AC-9:** WHEN a cycle contains no `forwardRef` edge, THE SYSTEM SHALL report
  exactly one `missing-forward-ref` diagnostic (warn, Correctness) at the
  closing edge's parameter position; WHEN at least one edge uses `forwardRef`,
  THE SYSTEM SHALL NOT report `missing-forward-ref` for that cycle.
- **AC-10:** WHEN a default-scope consumer (provider with `scope` `null` or
  `"singleton"`, or any controller) injects a provider recorded with
  `scope: "request"`, THE SYSTEM SHALL report exactly one
  `request-scoped-in-singleton` diagnostic (warn, Performance) at the parameter
  position; WHEN the consumer is itself request-scoped or the target is not
  request-scoped, THE SYSTEM SHALL NOT report.
- **AC-11:** WHEN nest is not among the detected frameworks, or the model is
  absent because extraction failed, THE SYSTEM SHALL produce no DI-rule
  diagnostics, keep the `nest-app-model` skippedCheck visible in the latter
  case, and complete the scan with unchanged exit codes.
- **AC-12:** WHEN the same Nest tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports (diagnostics and the extended `projects[].nest`).
- **AC-13:** WHEN config sets a DI rule to `"off"` THE SYSTEM SHALL produce no
  diagnostics for it, and WHEN set to `"error"` THE SYSTEM SHALL escalate its
  severity (exit code 1 when such diagnostics exist).
- **AC-14:** WHEN the feature ships, every DI rule SHALL have `valid/` and
  `invalid/` multi-file fixtures, snapshot tests of the exact diagnostics, and
  a markdown doc at `docs/rules/<rule-id>.md` (constitution §3).

## Testing strategy (TDD)

- **Fixtures** `tests/fixtures/nest/di-rules/<short-name>/{valid,invalid}/` —
  multi-file mini-apps (the per-rule flat layout cannot express cross-file DI;
  the F008 `tests/fixtures/nest/` precedent applies — deviation from
  constitution §3's `tests/fixtures/<rule-id>/` recorded here deliberately).
  No `package.json` needed at unit level (framework gate is passed explicitly).
  Planned trees:
  - `provider-not-registered/invalid/` — module registers `TasksController` +
    `TasksService`; the controller injects `@Injectable` `OrphanService` that
    no module lists (AC-6). `valid/` — same app with `OrphanService` provided,
    plus a `@Global` module export and a transitive `imports`/`exports` shape
    (AC-7).
  - `circular-di/invalid/` — `A ↔ B` decorated with `forwardRef` on both sides
    (only circular-di fires) plus a `C → D → E → C` chain (AC-8). `valid/` —
    acyclic chain.
  - `missing-forward-ref/invalid/` — `X ↔ Y` without `forwardRef` (AC-8 + AC-9
    both fire — pins the open-question-3 behavior). `valid/` — singleton + a
    request-scoped consumer pairing (AC-10 negative).
  - `request-scoped-in-singleton/invalid/` — `@Injectable({ scope: Scope.REQUEST })`
    `RequestContext` injected into singleton `OrdersService` (AC-10).
  - `model-extensions/` — one app exercising scope strings, `@Optional`,
    `forwardRef`, `@Global`, `hasUnresolved` via `useFactory`, and
    `{ module: X }` literals (AC-1..5).
- **Unit** — new `tests/unit/rules/nest-di.test.ts`: build the model with
  `extractNestAppModel` + real `TsMorphParserAdapter`, run each rule through
  `runRules` with `detectedFrameworks: ["nest"]` and the model; assert exact
  diagnostics (file, line, column, message, severity, category) — positions
  pinned the spec 007/008 way (print real coordinates on first failure).
  Extend `tests/unit/framework/nest-model.test.ts` for AC-1..5. Update the
  registry-count assertion in `tests/unit/rules/blocking.test.ts` (16 → 20).
- **Integration** — extend `tests/integration/scan.test.ts`: a staged Nest
  tree produces the DI diagnostics through the full pipeline (model wired via
  `runScan`); a non-nest tree produces none (AC-11).
- **e2e** — new `tests/e2e/nest-di-rules.test.ts` via `runCli`/`makeTmpDir`:
  JSON diagnostics from the built bin for an unregistered provider and a
  forwardRef-less cycle; determinism (two runs byte-identical, AC-12);
  severity override `off`/`error` incl. exit code 1 (AC-13); jsonl stays
  diagnostics-only; stdout-only report purity via `expectSuccess`.
- **Docs** — four rule docs under `docs/rules/backend-doctor/` (AC-14),
  following the existing rule-doc format (Problem / Bad / Good / Scope notes /
  Configuration); a unit assertion checks each shipped DI rule's `docs` path
  exists on disk (no generation/validation script yet — F017/F023 own that).
  New ts-morph facts discovered while probing (parameter decorators,
  `getTypeNode`) go to `docs/RESEARCH.md` per the deviations discipline.
- **No new dependencies** (open question 4); `parser/types.ts` grows only
  type-only re-exports (at least `ParameterDeclaration`, `ConstructorDeclaration`,
  `TypeNode`) per the established precedent.

## Open questions for review

1. **Expose the extended model fields in the JSON report?** The four new
   fields (`injections`, `scope`, `global`, `hasUnresolved`) and the `module`
   reference capture appear in `projects[].nest`. Recommendation: yes —
   serialize the model as-is (additive under constitution §5, no
   `schemaVersion` bump; agents get the app wiring for free; the alternative —
   an internal projection layer stripping rules-only fields — is extra code
   and a less useful report).
2. **The "blocking constructor work" PLAN bullet.** Recommendation: ship **no**
   rule for it in F009. `no-async-constructor-work` (F005) already flags async
   work in every constructor, and `no-sync-fs-in-request-path` /
   `no-sync-crypto` / `no-cpu-bound-loop` (F006) flag sync blocking inside any
   function body — including provider constructors — so a new rule would
   re-flag a strict subset of existing findings (double diagnostics per call),
   and the Nest-specific advice angle is F011's line ("heavy work in
   constructor instead of `onModuleInit`"). Alternative: ship a narrow
   `no-blocking-request-scoped-init` (sync fs/crypto in request-scoped
   constructors), accepting the known overlap with the F006 rules.
3. **`circular-di` × `missing-forward-ref` overlap.** Recommendation: both
   fire on a forwardRef-less cycle — one Architecture diagnostic at the class
   (what is wrong), one Correctness diagnostic at the parameter (how to fix the
   bootstrap crash); different positions and messages keep ids distinct. A
   cycle that already uses `forwardRef` gets only `circular-di`. Alternative:
   mutually exclusive split — `circular-di` only for cycles that already use
   `forwardRef`, `missing-forward-ref` for the rest (no overlap, but then
   plain cycles never get the plain circular-dependency finding).
4. **New dependencies.** Recommendation: none — cycle detection is a
   hand-rolled Tarjan over plain data; everything else reuses the existing
   traversal vocabulary. Alternative: none identified.
