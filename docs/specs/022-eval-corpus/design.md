# Design 022 — Eval corpus & precision gate

## Module layout

| Path | Purpose |
|------|---------|
| `evals/nest-good/` | Whole clean Nest app: 12 files under `src/` + `package.json` |
| `evals/nest-bad/` | Whole dirty Nest app: 16 analyzed files + `package.json` + committed `.env` + `scripts/blocking.cjs` |
| `biome.json` | `files.includes` gains `"!evals"` — the corpus contains deliberately Biome-violating code |
| `tests/e2e/goldens/eval-corpus.ts` | Typed golden data: expected `projects[]` shapes (both apps) and the bad app's full diagnostic set in report order |
| `tests/e2e/eval-corpus.test.ts` | All AC e2e tests (scans via `runCli`, probe via `runCliAsync`) |

No `src/` changes at all — this feature only adds data and tests (plus one
Biome config line). Both eval apps are self-contained package roots (verified:
`findPackageRoot` walks up to the nearest `package.json`, `src/core/scan.ts`);
neither carries a `tsconfig.json` (the engine collects by extension and builds
an in-memory ts-morph project — spec 003) nor a `backend-doctor.config.*` (the
gate must test the default-config experience; a tuned config could mask FPs).

## Key decisions

1. **Corpus lives under `evals/`**, not `tests/fixtures/`. PLAN's layout
   reserves `evals/` for whole applications; fixtures stay per-rule micro
   trees. Biome gets its own explicit `"!evals"` entry instead of leaning on
   the `tests/fixtures` exclusion. Alternative rejected: putting apps under
   `tests/` would drag them into vitest/tsc's mental model of "test code".
2. **Goldens are explicit typed data, pinned in report order, holding
   (rule, target-relative file, line, column, category, severity)** — not
   `id` (derivable from the pinned fields), not `message` (per-rule fixture
   tests already own the exact-message contract; double-pinning makes every
   wording tweak touch the corpus). Explicit deep-equal assertions, because
   the repo has zero `toMatchSnapshot` usage and snapshots hide
   absolute-path leakage. Alternative rejected: golden JSON files on disk —
   same data, worse typechecking and navigation.
3. **The precision gate is the e2e suite in `pnpm test`** (approved open
   question 4). No separate CI job; `ci.yml` stays untouched.
4. **Bad-app authoring follows a firing-site table** (below) with ≥1 site per
   registered rule (approved open question 2), co-located in a coherent —
   if badly designed — module graph, so the corpus reads like a real
   legacy app rather than a violation dump.
5. **The probe entry is a dependency-free `.cjs`** (bad app
   `scripts/blocking.cjs`, `require`-style, plain `node:` modules).
   `.cjs` is outside `SUPPORTED_EXTENSIONS`, so the static engine never sees
   it — the file cannot pollute the static goldens. It blocks via
   `crypto.pbkdf2Sync` (a wrapped probe API): a bare busy-wait loop would
   surface in `loopLag` but never in `blocking.calls`, which AC-8 pins.
6. **Good-app rule avoidance is by idiom, not by suppression**: every rule is
   dodged by writing the idiomatic form (paginated `findMany`, hooks pair
   `onModuleInit`/`onModuleDestroy`, zod-validated env in a config-shaped
   path, thin controllers, small services). No `ignore.rules`, no severity
   overrides.
7. **The bad app's committed `.env` is staged with `git add -f`** — the repo
   root `.gitignore` ignores `.env` at every depth (RESEARCH, spec 014); the
   bad app deliberately has no app-level `.gitignore`, which is exactly why
   `no-committed-env` fires.
8. **`evals/` apps' `package.json` dependencies mirror what their sources
   import** (good app) plus one deliberate never-imported dep (bad app:
   `moment` → `unused-dependency`). The engine reads dependency *keys* only;
   nothing is installed.

## Rule-interplay constraints (verified against `src/` today)

- `env-without-validation` is silenced by ANY file importing
  zod/class-validator/joi/envalid/convict/env-schema → the **bad app imports
  none of them**; its DTO violations ride the `*Dto` suffix recognition
  (`recognizeDto`, `extract.ts`), which needs no imports. The good app
  imports zod (config) and class-validator (DTOs) — each silences it.
- `no-direct-process-env` exempts config-shaped paths (`isConfigShapedPath`):
  directory segments like `config` or basename tokens `config|env|settings`.
  Good app reads `process.env` only under `src/config/`. Bad app reads it in
  `src/common/runtime-flags.ts` (deliberately not config-shaped).
- `no-floating-promises` skips constructor bodies (owned by
  `no-async-constructor-work`); `void f()` / awaited calls are never
  statement-level calls → good `main.ts` uses `void bootstrap()`, bad
  `main.ts` uses bare `bootstrap()`.
- `provider-not-registered` fires per *injection site*: the unregistered
  `LegacyExporterService` is injected twice (order + dashboard service) →
  exactly 2 diagnostics, pinned. All other injections are made resolvable via
  module imports/exports so nothing extra fires.
- `dto-field-without-validator` fires per undecorated property: the bad
  `CreateUserDto` has two (`name: string`, `metadata: any`) → 2 diagnostics;
  the second one is shared with `no-any-in-dto`.
- Module-API rules (fs/crypto/child_process) gate on the file importing the
  specifier and match property-form callees safely — the corpus uses
  `import * as fs from "node:fs"` + `fs.readFileSync(...)` shapes (bare-name
  calls risk the same-file shadow check).
- `missing-global-validation-pipe` fails open on unresolved module metadata →
  both apps use literal `providers:` arrays everywhere, so metadata resolves
  and the rule's verdict is real.

## Bad-app firing-site table (41 rules)

| Rule | Site |
|------|------|
| no-eval | `orders/legacy-transform.ts` — `eval(raw)` |
| no-new-func | `orders/legacy-transform.ts` — `new Function(...)` |
| no-command-injection | `orders/legacy-transform.ts` — `cp.exec(`template`)` |
| no-floating-promises | `main.ts` — bare `bootstrap()` |
| no-async-constructor-work | `reporting/metrics.service.ts` — `this.refresh()` in ctor |
| no-async-foreach-callback | `orders/orders.service.ts` — `forEach(async …)` |
| unhandled-json-parse | `orders/orders.service.ts` — unguarded `JSON.parse` in method |
| no-unhandled-emitter-error | `security/legacy-crypto.service.ts` — `bus.emit("error", …)` |
| no-sync-fs-in-request-path | `orders/orders.service.ts` — `fs.readFileSync` in method |
| no-sync-crypto | `security/legacy-crypto.service.ts` — `crypto.pbkdf2Sync` in method |
| no-cpu-bound-loop | `orders/orders.service.ts` — 50 000-iteration loop in method |
| no-path-traversal | `orders/orders.controller.ts` — `path.join(UPLOAD_DIR, req.params.name)` |
| no-hardcoded-secrets | `security/legacy-crypto.service.ts` — high-entropy `API_KEY` literal |
| no-weak-crypto | `security/legacy-crypto.service.ts` — `createHash("md5")` |
| no-ssrf | `orders/orders.controller.ts` — `fetch(req.body.url)` |
| no-unsafe-merge | `orders/orders.controller.ts` — `merge(profile, req.body)` |
| no-empty-catch | `orders/orders.service.ts` — `catch {}` |
| no-error-details-leak | `orders/orders.controller.ts` — `res.status(500).json({ stack })` |
| missing-on-module-destroy | `orders/inventory.service.ts` — `onModuleInit`, no shutdown hook |
| provider-not-registered (×2) | injections of `LegacyExporterService` in orders + dashboard services |
| circular-di + missing-forward-ref + circular-dependency | `orders.service` ↔ `inventory.service` (ctor cycle + file import cycle) |
| request-scoped-in-singleton | `metrics.service` injects request-scoped `RequestTrackerService` |
| no-business-logic-in-controller | `orders.controller` — handler with 2 `if` branches |
| no-repository-in-controller | `orders.controller` injects `PrismaService` |
| no-god-service | `reporting/dashboard.service.ts` — 6 constructor deps |
| missing-global-validation-pipe | `main.ts` — bootstrap without `useGlobalPipes` |
| dto-field-without-validator (×2) | `orders/dto/create-user.dto.ts` — `name`, `metadata` |
| no-any-in-dto | same DTO — `metadata: any` |
| no-heavy-constructor-work | `metrics.service` — `cp.execSync` in ctor |
| find-many-without-pagination | `orders.service` — `findMany()` without `take` |
| no-prisma-n-plus-one | `orders.service` — awaited `findUnique` in `for…of` |
| no-unsafe-raw-query | `orders.service` — `$queryRawUnsafe` with interpolated template |
| no-long-running-transaction | `orders.service` — awaited `fetch` inside `$transaction` |
| no-direct-process-env | `common/runtime-flags.ts` — `process.env.REGION` |
| unused-dependency | `moment` declared, never imported |
| unused-export | `legacy/old-report.service.ts` — export nobody imports |
| unused-file | `legacy/old-report.service.ts` — unreachable from `src/main.ts` |
| env-without-validation | project census — first access in `runtime-flags.ts`, no validation import |
| no-committed-env | committed `.env`, no app-level `.gitignore` |

Total: 44 pinned diagnostics (42 firing sites; `provider-not-registered` and
`dto-field-without-validator` fire twice each). Exact counts land with the
golden pinning in T3.

## Good-app shape (12 files)

`main.ts` (void bootstrap + global ValidationPipe), `app.module.ts` (+ health
controller), `config/{config.module,config.service}.ts` (zod-parsed env in a
config-shaped path), `prisma/{prisma.module,prisma.service}.ts` (init/destroy
hook pair), `users/{users.module,users.controller,users.service}.ts` (thin
controller, 2-dep service, paginated `findMany`), `users/dto/{create-user,
list-users}.dto.ts` (fully decorated). Dependencies: `@nestjs/common`,
`@nestjs/core`, `@prisma/client`, `class-validator`, `reflect-metadata`,
`zod` — every key imported somewhere (graph rules stay silent).

## Dependencies

None added. `evals/*/package.json` are corpus data, not the repository's
dependency surface.

## Test map (AC → test)

| AC | Test (`tests/e2e/eval-corpus.test.ts`) |
|----|----------------------------------------|
| AC-1 | `good app scans clean` — exit 0, empty stderr, zero diagnostics, frameworks `["nest","prisma"]`, `complete`, empty `skippedChecks` |
| AC-2 | `good app: two consecutive json scans are byte-identical` |
| AC-3 | `bad app matches the golden diagnostic set` — exit 0, normalized (rule, relFile, line, column, category, severity) deep-equal the golden array |
| AC-4 | `bad app: two consecutive json scans are byte-identical` |
| AC-5 | `corpus fires every registered rule at least once` — golden rule ids ⊇ `allRules()` ∪ `allProjectRules()` ids |
| AC-6 | `jsonl: one line per diagnostic with the pinned key order` (bad app) + good-app jsonl is empty |
| AC-7 | `projects[] golden` assertions inside the good/bad scan tests: sorted frameworks, full relative `analyzedFiles`, `analyzedFileCount`, `complete`, empty `skippedChecks`, `nest` key present |
| AC-8 | `probe on the bad app attributes deliberate blocking` — `runCliAsync`, `--out` tmp, `blocking.count ≥ 1`, `calls[0].file === "scripts/blocking.cjs"`, no `.backend-doctor/` under the corpus |
| AC-9 | `pnpm lint` green with the corpus committed (config gate; verified at every commit) |
