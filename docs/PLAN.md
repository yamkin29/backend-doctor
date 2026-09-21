# backend-doctor — Master Plan

A deterministic static analyzer for Node.js / NestJS backends — the backend analog of
[react-doctor](https://github.com/millionco/react-doctor). Distributed as an npm CLI:
`npx backend-doctor@latest`.

Feature lifecycle: **Draft spec → In review → Approved → In progress → Done**.
Each feature below is developed via **Spec Driven Design** (spec → design → tasks,
see [constitution.md](./constitution.md)); small implementation tasks inside a feature
follow **TDD** (red → green → refactor).

## 1. Decisions

- **Name/package:** `backend-doctor` (npm name is free; repo folder stays `Node-doctor`).
  `node-doctor` and `nest-doctor` are already taken on npm.
- **Engine:** ts-morph (TS compiler API) hidden behind a `ParserAdapter` interface;
  Engine v2 migrates the adapter to oxc-parser (the react-doctor stack) without
  rewriting rules.
- **First ORM:** Prisma (rules + fixtures). TypeORM/Mongoose packs come later.
- **Docs/specs/commit language:** English. Chat communication: Russian.
- **MVP scope:** local audit. CI/agent integrations come in later phases; the runtime
  engine is a mandatory dedicated phase (Phase 5).

## 2. Methodology: SDD for features + TDD for tasks

- This file (`docs/PLAN.md`) is the master roadmap; updated after every feature.
- `docs/constitution.md` — non-negotiable principles.
- Per feature: `docs/specs/NNN-kebab-slug/` with `spec.md` (problem, goals/non-goals,
  user stories, EARS acceptance criteria), `design.md`, `tasks.md`.
- Feature flow: spec draft → review → design.md → tasks.md → TDD implementation →
  verification → status updated here.

## 3. Stack & repository layout

Node 20+, TypeScript strict, pnpm, tsup (bin `backend-doctor`), commander (CLI),
ts-morph, vitest, Biome (lint/format), GitHub Actions CI (lint+test). Single package
with hard internal module boundaries for MVP; packages are split out only when needed
(plugins, action).

```
Node-doctor/
├─ src/
│  ├─ cli/          # commands: scan, rules, init
│  ├─ config/       # defineConfig, config.ts/.json loading, walk-up resolution
│  ├─ engine/       # ParserAdapter (ts-morph), RuleRegistry, RuleRunner, Diagnostic
│  ├─ rules/        # async/ security/ nest/ prisma/ maintainability/ config/
│  ├─ framework/    # detection: nest, express, fastify, prisma
│  └─ reporters/    # pretty, json, jsonl
├─ tests/fixtures/  # per-rule valid/invalid fixtures + snapshots
├─ evals/           # whole test Nest applications (good/bad)
├─ docs/            # PLAN.md, constitution.md, HOW_TO_WRITE_A_RULE.md, specs/
├─ skills/          # SKILL.md for coding agents (F017)
└─ action.yml       # composite GitHub Action (F016)
```

Diagnostic model (spiritually compatible with react-doctor):
`{ id (deterministic), filePath, line, column, rule, category, severity (error|warn),
message, tags[] }`. JSON report: `{ schemaVersion, mode, directory, diagnostics[],
projects[] }`.

## 4. Roadmap

| ID | Feature | Phase | Status |
|----|---------|-------|--------|
| F001 | CLI skeleton & DX | 0 | Done |
| F002 | Config (defineConfig, walk-up, overrides) | 0 | Done |
| F003 | Engine core (ParserAdapter, RuleRegistry, RuleRunner, reporters) | 0 | Done |
| F004 | Framework detection (nest/express/fastify/prisma) | 0 | Done |
| F005 | Rules: async correctness | 1 | Done |
| F006 | Rules: event-loop blocking | 1 | Done |
| F007 | Rules: security (Node core) | 1 | Done |
| F008 | Nest app model (decorators → app model) | 2 | Done |
| F009 | Rules: Nest DI | 2 | Done |
| F010 | Rules: layers & DTO | 2 | Done |
| F011 | Rules: errors & lifecycle | 2 | Done |
| F012 | Rules: Prisma | 2 | Done |
| F013 | Graph rules (cycles, unused) | 3 | Done |
| F014 | Rules: config/env | 3 | Done |
| F015 | Diff scope (changed/files/lines) | 4 | Done |
| F016 | GitHub Action (`ci install`, PR comments) | 4 | Done |
| F017 | Agent integration (SKILL.md, rule docs, jsonl) | 4 | Done |
| F018 | Runtime probe runner | 5 | Done |
| F019 | Event loop & blocking attribution | 5 | Done |
| F020 | HTTP runtime tracing | 5 | Done |
| F021 | Combined report (static + runtime) | 5 | Planned |
| — | Engine v2: ParserAdapter → oxc-parser | 5 (in-phase) | Planned |
| F022 | Eval corpus & precision gate | 6 | Planned |
| F023 | npm publish & README | 6 | Planned |

### Phase descriptions

**Phase 0 — Foundation**
- **F001 CLI skeleton & DX** — repo init (pnpm, tsconfig strict, tsup, vitest, Biome,
  CI); `scan [path]` command with `--format pretty|json|jsonl`, `--config`, `--ignore`;
  exit codes (0 ok / 1 error-severity diagnostics / 2 config or usage error).
- **F002 Config** — `backend-doctor.config.ts` (defineConfig API) / `.json` /
  `backendDoctor` key in package.json; walk-up resolution; fields `rules`,
  `categories`, `ignore.{files,rules}`; CLI flags override config.
- **F003 Engine core** — TS project discovery via tsconfig; ParserAdapter;
  RuleRegistry + RuleRunner (visitors per file); Diagnostic model; pretty/json/jsonl
  reporters; severity summary.
- **F004 Framework detection** — detect Nest/Express/Fastify/Prisma from package.json
  + code markers; `projects[]` block in JSON; activates rule packs.

**Phase 1 — Node core rules (first batch, ~15 rules)**
- **F005 Async correctness** — `no-floating-promises` (heuristic; type-aware later),
  `no-async-foreach-callback`, `unhandled-json-parse`, `no-async-constructor-work`,
  event-emitter `error` without handler.
- **F006 Event-loop blocking** — `no-sync-fs-in-request-path` (`readFileSync` etc.),
  `no-sync-crypto`, CPU-bound loop heuristics in handlers.
- **F007 Security (Node core)** — command injection (`child_process` + interpolated
  input), path traversal (`path.join(req.*)`), `no-eval`/`new Function`, hardcoded
  secrets (regex + entropy), weak crypto (md5/sha1), SSRF (user input in fetch/axios
  URL), prototype pollution (deep merge of external input).

**Phase 2 — Nest specifics & Prisma**
- **F008 Nest app model** — parse `@Module/@Controller/@Injectable` decorators into an
  application model (modules, providers, controllers, DTOs); foundation for all
  Nest rules.
- **F009 DI rules** — provider not registered in module, circular DI (via graph),
  heavy request-scoped provider, blocking constructor work, missing `forwardRef`.
- **F010 Layers & DTO** — business logic in controller, controller → repository
  directly, god-service, missing global `ValidationPipe`, DTO field without validator,
  `any` in DTO.
- **F011 Errors & lifecycle** — error details/stack leaked to client, `empty-catch`,
  resource without `onModuleDestroy`, heavy work in constructor instead of
  `onModuleInit`.
- **F012 Prisma rules** — N+1 (`findMany` + query in loop), raw query string
  concatenation, `findMany` without pagination, long-running transactions.

**Phase 3 — Project-level (opt-in, full scan)**
- **F013 Graph rules** — `circular-dependency`, `unused-export`, `unused-file`,
  `unused-dependency` (import graph).
- **F014 Config/env rules** — direct `process.env` in business code (config module
  instead), env without validation (zod/class-validator), committed `.env`.

**Phase 4 — Integrations**
- **F015 Diff scope** — `--scope changed|files|lines`, merge-base diff,
  deterministic diagnostic ids.
- **F016 GitHub Action** — `backend-doctor ci install` generates a workflow; composite
  action: sticky PR comment, inline review comments (capped), commit status,
  `blocking: none` by default.
- **F017 Agent integration** — `skills/backend-doctor/SKILL.md`, markdown rule docs
  generation (`docs/rules/{id}.md`), `rules list/explain`, stable `--format jsonl`.

**Phase 5 — Runtime engine (react-doctor parity)**
Mandatory phase: the analog of `react-doctor scan <url>`, but for a Node process.
Zero-intrusion: the app is started via `backend-doctor probe -- <start command>` with a
`--require` hook, no changes to user code.
- **F018 Probe runner** — run the target app instrumented; profiling session
  (duration/filters); traces stored locally; warning about data sensitivity.
- **F019 Event loop & blocking attribution** — `perf_hooks.monitorEventLoopDelay` +
  `async_hooks`: attribute lags and blocking operations to `file:line`; report
  "handler X blocked the loop for Nms, culprit: users.service.ts:42".
- **F020 HTTP runtime tracing** — endpoint latency (Express/Fastify/Nest interceptors),
  DB query count per request (runtime N+1 detection), memory/GC signals.
- **F021 Combined report** — merge runtime findings with static ones (tag `runtime`),
  unified report and reporters.
- **Engine v2 (in this phase)** — migrate `ParserAdapter` to oxc-parser (react-doctor
  stack) as the rule base grows; rules unchanged.

**Phase 6 — Quality & release**
- **F022 Eval corpus** — 2–3 whole Nest applications good/bad; CI gate: 0 diagnostics
  on the good app (precision budget); golden tests of the JSON report; probe check on
  a bad app with deliberate blocking.
- **F023 Publish** — npm publish `backend-doctor`, README, rule docs generation script.

## 5. Verification strategy

- Every rule: valid/invalid fixtures + diagnostic snapshot tests (vitest), written
  before implementation (TDD).
- Engine/config/reporters/probe: integration tests on a mini project.
- Evals: whole applications in CI; a rule is accepted only with zero false positives
  on the good corpus.
- JSON report: contract test of the schema; `schemaVersion` bump on breaking changes.

## 6. Out of scope (for now)

LLM-assisted checks in the engine, GitLab CI (scaffold only), docs website,
TypeORM/Mongoose rule packs.
