# Design 009 — Nest DI rules

## 1. Module layout

| File | Purpose |
|---|---|
| `src/framework/nest/model.ts` | Extended: `NestInjectionRef`, `scope` + `injections` on providers, `injections` on controllers, `global` + `hasUnresolved` on modules. Plain data, unchanged boundary. |
| `src/framework/nest/extract.ts` | Extraction of injections (constructor params), scope, `@Global`, `hasUnresolved`; `module` key in `readableClassReference`. |
| `src/engine/parser/types.ts` | Type-only re-export growth: `ConstructorDeclaration`, `ParameterDeclaration` (vocabulary the extractor needs; precedent spec 007/008). |
| `src/rules/nest/di-graph.ts` | Pure model queries shared by the four rules: consumer lookup per file, provider-name index, cycle components (canonical path, closing edge, forwardRef flag), resolvability walk. No AST, no ts-morph. |
| `src/rules/nest/provider-not-registered.ts` | Rule 1 (Correctness, warn). |
| `src/rules/nest/circular-di.ts` | Rule 2 (Architecture, warn). |
| `src/rules/nest/missing-forward-ref.ts` | Rule 3 (Correctness, warn). |
| `src/rules/nest/request-scoped-in-singleton.ts` | Rule 4 (Performance, warn). |
| `src/rules/index.ts` | Registers the four rules (registry grows 16 → 20). |
| `docs/rules/backend-doctor/<id>.md` | Four rule docs (constitution §3). |
| `tests/fixtures/nest/di-rules/**` | Multi-file mini-apps (spec §Testing). |
| `tests/unit/rules/di-graph.test.ts` | Pure helper tests (inline models, no fixtures). |
| `tests/unit/rules/nest-di.test.ts` | Exact-diagnostic tests for the four rules. |
| `tests/unit/framework/nest-model.test.ts` | Extended for AC-1..5. |
| `tests/integration/scan.test.ts` | Extended: gate off, model absent, pipeline wiring (AC-11). |
| `tests/e2e/nest-di-rules.test.ts` | Bin-level: findings, determinism, severity overrides, jsonl purity (AC-12/13). |

## 2. Key decisions

1. **Model queries live in one pure module (`di-graph.ts`), not in the rules.**
   Alternative: each rule re-derives provider indexes and cycle detection —
   duplicated Tarjan/resolution logic with four chances to drift. The rules
   become thin: filter consumers by `filePath`, map components/edges to
   diagnostics.
2. **Cycles: Tarjan SCC over the model-sorted provider array.** Nodes are
   provider entries in the model's existing `(filePath, className)` sort;
   edges are injection names matched to provider class names (one injection
   may fan out to duplicate class names — all are edges). Components with
   size > 1 or a self-loop are cycles. Alternative: DFS back-edge tracking —
   finds *a* cycle but not all members; SCC gives one stable component per
   knot, which is what "one diagnostic per cycle" needs.
3. **Canonical cycle path by lexicographic DFS.** From the canonical member
   (first in model order within the component), repeatedly follow the smallest
   injected name (ties: smallest `(filePath, className)` target) until the
   first simple path returns to the canonical member. Deterministic and
   independent of traversal order; the path is what the messages render.
   Alternative: report component size without a path — less actionable, and
   the closing edge (needed for `missing-forward-ref`'s position) would still
   require picking a deterministic edge.
4. **`missing-forward-ref` position = closing edge's parameter** (the edge
   from the last path member back to the canonical member, first matching
   injection in source order). The consumer owning that parameter is the file
   that reports. Alternative: canonical member's class — then both rules share
   one position and the fix site (the parameter) is lost.
5. **Resolvability as a fail-open walk.** `provider-not-registered` resolves
   `P` from each owning module independently: `P ∈ M.providers`, or some
   module on `M`'s transitive `imports` exports `P`, or any `@Global` module
   exports `P`. Any consulted module with `hasUnresolved`, any import name
   without a model entry, and `P ∈ M.exports`-without-providers (re-export
   only helps importers, not the owner) are handled per spec AC-7. Flag only
   when unresolvable from **every** owning module — keeps one diagnostic per
   edge, avoids id collisions on the same parameter.
6. **Injections from type-node text, not the type checker.** A parameter
   contributes an edge when its type annotation's text is a bare identifier
   (`/^[A-Za-z_$][\w$]*$/`); primitives and generics/qualified/unreadable
   types are skipped. `forwardRef` is detected via `@Inject(forwardRef(…))`.
   Alternative: `TypeReferenceNode` guards — more precise typing but another
   ts-morph prototype surface to probe (RESEARCH warns); the regex on
   `getText()` is boring and testable. Documented holes: aliased imports and
   generics are not edges.
7. **Scope reading is strict.** Only `Scope.REQUEST|DEFAULT|TRANSIENT`
   property-access and `"request"|"singleton"|"transient"` literals map;
   anything else → `null` (no `unresolved` noise — scope is a detail, and
   `null` is the safe default for the request-scoped rule). Alternative: push
   an `unresolved` entry per unreadable scope — report noise on shapes that
   are none of our rules' business.
8. **`hasUnresolved` is a per-module boolean**, set at every `unresolved` push
   site inside `readModule` (including the metadata-not-a-literal case).
   Alternative: attach `moduleId`/`list` to `NestUnresolvedRef` — a bigger
   contract change for a bit the rules only need as a boolean.
9. **Rules read positions from the model, never the AST** — `ReportInput`
   line/column fallbacks. Keeps the F008 boundary ("consumers never touch AST
   nodes") and makes the rules unit-testable with hand-built models.
10. **Registry count assertions move with each rule task** (16 → 17 → … → 20)
    so every green commit is green; the product registry stays explicit and
    greppable (spec 003 design).

## 3. Dependencies

None new (open question 4). `di-graph.ts` is plain TypeScript over the model;
cycle detection is a hand-rolled Tarjan (~40 lines).

## 4. Test map (AC → test)

| AC | Test |
|---|---|
| AC-1 (scope capture) | `tests/unit/framework/nest-model.test.ts` — `model-extensions` fixture: `Scope.REQUEST` → `"request"`; bare `@Injectable()` → `null`; unreadable scope → `null` |
| AC-2 (injections capture) | same file — source order, `forwardRef` flag, pinned param positions, `@Optional` excluded, no-constructor → `[]` (controller + provider) |
| AC-3 (`@Global`) | same file — `global: true` on the decorated module, `false` otherwise |
| AC-4 (`hasUnresolved`) | same file — module with `useValue`/`useFactory` element → `true`, unresolved entry still recorded; clean module → `false` |
| AC-5 (`{ module: X }`) | same file — imports array carries the DynamicModule literal's class name |
| AC-6 (unregistered fires) | `tests/unit/rules/nest-di.test.ts` — `provider-not-registered/invalid` exact diagnostics |
| AC-7 (fail-open silence) | same file — `valid` tree (direct provide, transitive export, `@Global` export, unknown class, `@Optional`, re-export-only module); `tests/unit/rules/di-graph.test.ts` — resolvability walk cases incl. `hasUnresolved` and unknown import names |
| AC-8 (circular-di) | `nest-di.test.ts` — `circular-di/invalid`: forwardRef pair (1 diagnostic), three-node cycle (1), self-loop (1); canonical member file reports, other files don't |
| AC-9 (missing-forward-ref) | `nest-di.test.ts` — `missing-forward-ref/invalid` closing-edge diagnostic; `valid` (forwardRef pair + acyclic) silent |
| AC-10 (request-scoped) | `nest-di.test.ts` — `request-scoped-in-singleton/invalid` (provider + controller consumers); `valid` (request-scoped consumer, transient, plain injection) silent |
| AC-11 (gate + model absent) | `nest-di.test.ts` — rules no-op with `nest: undefined`; `tests/integration/scan.test.ts` — non-nest tree: no DI diagnostics; crash path keeps `nest-app-model` skippedCheck |
| AC-12 (determinism) | `tests/e2e/nest-di-rules.test.ts` — two `runCli` scans byte-identical |
| AC-13 (severity config) | same file — config override `off` → silent exit 0; `error` → exit 1; jsonl stays diagnostics-only |
| AC-14 (docs/fixtures) | `nest-di.test.ts` — each rule's `docs` path exists; fixture dirs follow the spec layout |

Fixtures needing no committed tree: `di-graph.test.ts` (hand-built
`NestAppModel` objects) and the model-absent no-op unit cases.
