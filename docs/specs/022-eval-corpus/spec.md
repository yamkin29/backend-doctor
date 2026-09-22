# Spec 022 — Eval corpus & precision gate (F022)

- **Status:** Draft — pending review
- **Phase:** 6 — Quality & release
- **Depends on:** F001–F021 (all Done) — the corpus exercises the full shipped
  surface: 36 AST rules, 6 project rules, framework detection, reporters, probe.
- **Blocks:** F023 (npm publish & README — the README's precision claims stand on
  this gate)

## Problem

All 42 registered rules were built against per-rule micro-fixtures
(`tests/fixtures/<rule-id>/valid|invalid`). Nothing proves the engine stays
**silent on a realistic clean application** — constitution §2's precision budget
("zero false positives on the good corpus") is written down but not enforced
anywhere. Nothing either exercises the whole pipeline (collection → detection →
Nest model → per-file rules → project rules → report) on a whole realistic tree
rather than a two-file fixture, or the runtime probe against an application with
real blocking work attributed to its own sources. Before the package is
published (F023), the corpus and the gate are the quality floor.

## Goals

- `evals/nest-good/` — a whole, realistic Nest application (modules, controllers,
  services, DTOs with validators, global `ValidationPipe`, Prisma access with
  pagination, zod-validated env config) that the engine scans with **zero
  diagnostics** — the precision gate of constitution §2, enforced on every
  `pnpm test` run and therefore in CI.
- `evals/nest-bad/` — a whole Nest application with deliberate violations that
  fires every registered rule at least once (pending open question 2), pinned by
  a golden test down to rule id, target-relative path, line and column.
- Golden tests of the JSON report for both apps: pinned `projects[]` shape and
  pinned diagnostic sets (machine-independent: target-relative paths), plus
  byte-identical determinism on both trees.
- A probe check: the bad app carries a dependency-free entry with deliberate
  blocking; a probe session must record `blocking.count >= 1` with the culprit
  inside the bad app.
- The corpus is committed and excluded from Biome (like `tests/fixtures`), so
  `pnpm lint` stays green despite intentionally bad code.

## Non-goals

- **Numeric recall/precision metrics** (percentages, scored evals) — no feature
  owns them; out of scope until a future spec asks.
- **Engine v2 / oxc-parser migration** — separate in-phase line in PLAN, not this.
- **Publishing, README, docs generation** — F023.
- **Installing or running the eval apps' npm dependencies** — the corpus is
  static data; the only executed code is the bad app's dependency-free blocking
  entry (plain `node:` modules). No new repository dependencies.
- **New rules, changed rule behavior, changed severities** — if the good app
  exposes a false positive, the rule is fixed under §2 as a defect; this spec
  adds no rule and touches no registry entry.
- **`scan --trace` merge coverage** — already tested by spec 021; the probe check
  here asserts `findings.json` only.
- **TypeORM/Mongoose packs, docs website, CI/agent integrations** — PLAN §6.

## User stories

1. **Backend developer** — reads `evals/nest-good/` as executable documentation
   of "what clean means under backend-doctor" and `evals/nest-bad/` as the
   catalog of every rule firing on realistic code; runs the CLI on either tree
   and gets the documented result.
2. **CI author** — `pnpm test` (already a CI job) fails if the good app ever
   produces a diagnostic (precision regression) or the bad app's findings drift
   from the golden set (silent rule change); exit codes follow the standing
   contract (0 on the warn-only bad app, 0 on the clean app).
3. **AI agent** — the golden diagnostics are machine-checkable expectations in
   the repo; `--format json|jsonl` on the corpus keeps the pinned key order and
   deterministic ids, so agents can diff corpus outputs across versions.

## Contract / Model

No CLI, config, report-schema, or exit-code changes (constitution §5). New
repository surface:

```
evals/
├─ nest-good/               # whole clean Nest app (precision budget)
│  ├─ package.json          # declares only directly-imported deps (unused-dependency safe)
│  └─ src/…                 # bootstrap w/ global ValidationPipe, modules, DTOs, Prisma, zod config
└─ nest-bad/                # whole dirty Nest app (recall catalog + probe target)
   ├─ package.json          # incl. one never-imported dependency (unused-dependency)
   ├─ .env                  # committed dotenv candidate, no app-level .gitignore → no-committed-env
   ├─ scripts/blocking.cjs  # dependency-free deliberate-blocking entry (probe target)
   └─ src/…                 # ≥1 firing site per registered rule
```

- Engine facts the corpus relies on (all verified in `src/` today): package root
  is the nearest `package.json` (`findPackageRoot`, `src/core/scan.ts`), so both
  apps are self-contained projects; entries come from `main`/`bin` plus
  conventional `src/main.ts` (`findEntryFiles`, `src/engine/imports.ts`);
  framework detection reads `dependencies` keys and module specifiers
  (`src/framework/markers.ts`) — each app declares `@nestjs/common`, `@nestjs/core`,
  `@prisma/client` and imports them, so both detect `["nest", "prisma"]`; DTO
  recognition by `Dto`/`DTO` class-name suffix needs no imports
  (`recognizeDto`, `src/framework/nest/extract.ts`).
- **Rule-interplay constraints** discovered while verifying: `env-without-validation`
  is silenced by any import of zod/class-validator/joi/envalid/convict/env-schema
  — so the bad app's DTO violations must use the suffix path with no validation
  import anywhere, while the good app imports zod. `no-committed-env` consults
  only the package-root `.gitignore`; the repo root `.gitignore` already ignores
  `.env` at every depth, so `evals/nest-bad/.env` must be staged with `git add -f`
  (RESEARCH, spec 014 lesson).
- **Tooling contract:** `biome.json` `files.includes` gains `"!evals"` (today only
  `tests/fixtures` is excluded); vitest (`include: tests/**`) and `tsc`
  (`include: src, tests, …`) already ignore `evals/` — no changes there.
- Golden data lives as typed fixtures next to the tests (target-relative paths,
  no absolute paths, no timestamps), so goldens stay byte-stable across machines.
- Probe storage in tests goes through `probe --out <tmp>` so no
  `.backend-doctor/` directory ever appears inside `evals/` (the probe's storage
  root is `--out` when given — `src/probe/runner.ts`).

## EARS acceptance criteria

- **AC-1** WHEN `scan evals/nest-good --format json` runs, THE SYSTEM SHALL exit 0,
  write nothing to stderr, and report zero diagnostics with
  `projects[0].frameworks` equal to `["nest", "prisma"]`, `complete: true`, and
  an empty `skippedChecks`.
- **AC-2** WHEN the good app is scanned twice with `--format json`, THE SYSTEM
  SHALL produce byte-identical stdout.
- **AC-3** WHEN `scan evals/nest-bad --format json` runs, THE SYSTEM SHALL exit 0
  (all findings warn-severity) and emit exactly the golden diagnostic set —
  every pin carries rule id, target-relative path, line, column, category and
  severity; no diagnostic outside the golden set, none missing.
- **AC-4** WHEN the bad app is scanned twice with `--format json`, THE SYSTEM
  SHALL produce byte-identical stdout.
- **AC-5** WHEN the corpus (both apps) is scanned, THE SYSTEM SHALL fire every
  registered rule id at least once across the two trees — the good app
  contributing zero and the bad app the pinned sites (pending open question 2).
- **AC-6** WHEN `scan <app> --format jsonl` runs on either app, THE SYSTEM SHALL
  print one diagnostic per line with the pinned key order
  (`id, filePath, line, column, rule, category, severity, message, tags`).
- **AC-7** WHEN the JSON report of either app is inspected, THE SYSTEM SHALL match
  the golden `projects[]` block: sorted `frameworks`, the complete
  target-relative `analyzedFiles` list, `analyzedFileCount`, `complete: true`,
  empty `skippedChecks`, and the `nest` model key present (both apps are nest).
- **AC-8** WHEN the bad app's `scripts/blocking.cjs` runs under
  `backend-doctor probe --duration <n> --out <tmp> -- node scripts/blocking.cjs`
  with cwd = `evals/nest-bad`, THE SYSTEM SHALL write `findings.json` with
  `blocking.count >= 1` whose call file resolves inside the bad app, and leave no
  `.backend-doctor/` directory inside the corpus tree.
- **AC-9** WHEN `pnpm lint` runs on the repository including `evals/`, THE SYSTEM
  SHALL pass — the corpus is excluded from Biome while the rest of the repo is
  still linted (verified by the change to `biome.json` itself being linted).

## Testing strategy (TDD)

All tests are e2e against the committed corpus (`tests/e2e/eval-corpus.test.ts`),
spawned through the existing helpers: `runCli` for scans (sync, no HTTP),
`runCliAsync` for the probe session (async — the child runs while the worker
keeps its event loop; spec 016 lesson). The corpus trees are the fixtures —
nothing is generated into temp dirs for the static tests; the probe test uses a
temp `--out` and the repo cwd trick from `tests/e2e/probe.test.ts`. Golden data
is committed as typed arrays (`tests/e2e/goldens/eval-corpus.ts`) holding the
expected diagnostics (rule, relative path, line, column, category, severity) and
the expected `projects[]` shapes. The repo has no `toMatchSnapshot` usage — the
golden test follows the house style of explicit equality assertions against
pinned data. No committed fixture is needed beyond the corpus itself; the
existing per-rule fixtures stay untouched.

Deliberately authoring-sensitive points the tests will hold us to: the good app
must dodge all 42 rules without contortions (that is the precision claim —
plain, idiomatic Nest code); the bad app's firing sites copy the `invalid/`
fixture patterns of each rule into realistic files.

## Open questions for review

1. **Corpus size — 2 apps or 3?** PLAN says "2–3 whole Nest applications
   good/bad". **Recommendation: 2** (`nest-good`, `nest-bad`). The probe check
   rides on the bad app; a third app would duplicate coverage without a
   precision/recall question to answer.
2. **Coverage bar for the bad app.** **Recommendation: every registered rule
   fires at least once** across the corpus (AC-5). This makes the corpus a true
   catalog and the golden test a regression fence for all 42 rules. The
   cheaper alternative (a representative subset) weakens the gate; the fixture
   patterns for each rule already exist, so the cost is authoring time only.
3. **Prisma in the good app.** **Recommendation: yes** — the good app imports
   `@prisma/client` (a `PrismaService` with paginated queries), so the prisma
   pack's precision is also gated by the clean tree. Static only; no client is
   installed, no schema needed (import marker suffices for detection).
4. **Dedicated CI job for the gate?** The precision gate rides in `pnpm test`
   (already a CI step). **Recommendation: no separate workflow job** — same
   enforcement, boring pipeline. Can be added later without contract changes.
