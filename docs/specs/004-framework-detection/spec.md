# Spec 004 — Framework detection (F004)

- **Status:** Implemented (2026-09-19)
- **Phase:** 0 — Foundation
- **Depends on:** F001 (CLI), F002 (Config), F003 (Engine core) — all Done
- **Blocks:** F008–F012 (Nest app model and Nest/Prisma rule packs run only when
  their framework is detected)

## Resolution (recorded at implementation, 2026-09-19)

All open questions were approved as recommended: (1) `dependencies` only;
(2) ids `nest`/`express`/`fastify`/`prisma`; (3) allowlist Nest markers;
(4) pretty `Frameworks:` line; (5) no manual gate override; (6) no new
dependencies. Deviations from the task sketch are listed in
[tasks.md](./tasks.md).

## Problem

The engine is real (F003) but `projects[].frameworks` is a stub: `runScan` always
emits `[]` (`src/core/scan.ts:74-83`). Every later rule pack needs to know which
runtime a project targets — Nest DI rules are noise on an Express app, Prisma rules
are noise without a Prisma schema. Without a shared detection step, each future rule
would grow its own ad-hoc "am I relevant here" logic. F004 builds the single
detection pass and the rule-pack gate, so Phase 1–2 rules can be written as if the
framework were always known.

## Goals

- Detect `nest`, `express`, `fastify`, `prisma` from the direct `dependencies` of
  the project's `package.json` (exact package names).
- Detect the same frameworks from code markers in analyzed files: module specifiers
  of static imports, dynamic `import("…")` and `require("…")` calls.
- Detect `prisma` additionally from the presence of `prisma/schema.prisma` under
  the package root.
- Fill `projects[].frameworks` — deduplicated, alphabetically sorted.
- Pack-activation mechanism: a rule may declare required frameworks; the runner
  runs it only when every declared framework is detected. Rules without
  declarations keep running unconditionally (`no-eval`, `no-new-func` unchanged).
- `package.json` read/parse failures land in `projects[].skippedChecks`
  (constitution §8); detection continues with code markers.
- Determinism (constitution §1): same tree → same `frameworks`, byte-identical
  reports.

## Non-goals

- Multi-project / monorepo detection — one project per scan, nearest
  `package.json` (F003 semantics). Not owned by any scheduled feature; adding
  workspaces would need a new PLAN line first.
- No new rule packs ship here — mechanism only (Nest rules are F008+, Prisma F012).
- No framework version reporting; no lockfile or `node_modules` scanning.
- No type-aware detection (no tsconfig/typechecker use).
- No new config fields, no manual gate override (open question 5).
- No `schemaVersion` bump — `frameworks` is already in schema v1 (specs 001/003);
  filling it is additive. Exit codes untouched.

## User stories

1. As a backend developer, I run `backend-doctor scan .` in a Nest + Prisma app and
   the report names the detected frameworks; later Nest/Prisma packs fire
   automatically, with no config.
2. As a CI author, I branch on `projects[].frameworks` in the JSON report; exit
   codes and the stdout-report/stderr-error discipline are unchanged — detection
   problems never produce exit 2.
3. As an AI agent, I read `frameworks` from the JSON report to pick which rule docs
   to load for the codebase; `jsonl` diagnostics keep their exact shape (projects
   were never part of jsonl).

## Contract

### Framework ids

Exact strings, the values consumers will branch on: `nest`, `express`, `fastify`,
`prisma` (see open question 2).

### Detection matrix

A framework is detected when **any** of its markers matches:

| id | `package.json` marker (exact `dependencies` key) | code markers (module specifiers) | file markers |
|----|--------------------------------------------------|----------------------------------|--------------|
| `nest` | `@nestjs/common`, `@nestjs/core` | `@nestjs/common`, `@nestjs/core`, prefix `@nestjs/platform-` | — |
| `express` | `express` | exact `express` | — |
| `fastify` | `fastify` | exact `fastify` | — |
| `prisma` | `@prisma/client` | exact `@prisma/client` | `prisma/schema.prisma` exists under packageRoot |

- "dependencies" = the `dependencies` object only; `devDependencies` and
  `peerDependencies` are ignored (open question 1). Versions are ignored;
  matching is on exact key names.
- Code marker = a module specifier actually referenced by an analyzed file —
  static import, dynamic `import("…")`, or `require("…")` — collected through the
  parser adapter (AST-derived, not text search), so occurrences in comments or
  unrelated string literals do not match.
- Non-marker packages never activate anything: `@nestjs/cli`, `@nestjs/testing`,
  `@types/express`, `fastify-plugin`, `@fastify/*` (precision, constitution §2).
- Output: `projects[].frameworks` — unique, sorted alphabetically. `packageRoot`
  semantics unchanged (nearest `package.json` walking up from the target,
  fallback target — `src/core/scan.ts:97-105`).

### Failure handling

- No `package.json` anywhere up from the target: dependency-based detection yields
  nothing; this is a normal state (frameworks may still come from code markers) —
  no `skippedChecks` entry.
- `package.json` present but unreadable or unparseable: `skippedChecks` entry
  `{ check: "framework-detection", reason }` and the scan continues
  (constitution §8).

### Rule-pack gate

- `RuleDefinition` gains an optional field `frameworks?: readonly string[]`.
- A rule runs iff every framework it declares is detected; absent or empty means
  unconditional. Gating happens before severity resolution; a gated-off rule is
  disabled **by design** (like severity `off`) — it produces no diagnostic and no
  `skippedChecks` entry.
- Config validation is unchanged: pack rule ids are registered eagerly in
  `src/rules/index.ts`, so `knownRuleIds` (`src/cli/commands/scan.ts:23`) already
  accepts them on projects where the pack is off.

### Pipeline and output

- `runScan` order: collect → parse → detect frameworks (packageRoot + parsed
  files) → gate rules → run rules → assemble `projects[0]` (now with `frameworks`).
- Reporters: json renders frameworks via the existing `projects[]` serialization;
  jsonl is unchanged (diagnostics only); pretty — open question 4.
- Exit codes (`src/core/exit-code.ts`) and `REPORT_SCHEMA_VERSION` unchanged.

## EARS acceptance criteria

- **AC-1:** WHEN the project's `package.json` lists `@nestjs/common` or
  `@nestjs/core` in `dependencies`, THE SYSTEM SHALL include `"nest"` in
  `projects[].frameworks`.
- **AC-2:** WHEN `package.json` lists `express` in `dependencies`, THE SYSTEM SHALL
  include `"express"` in `projects[].frameworks`.
- **AC-3:** WHEN `package.json` lists `fastify` in `dependencies`, THE SYSTEM SHALL
  include `"fastify"` in `projects[].frameworks`.
- **AC-4:** WHEN `package.json` lists `@prisma/client` in `dependencies` OR
  `prisma/schema.prisma` exists under packageRoot, THE SYSTEM SHALL include
  `"prisma"` in `projects[].frameworks`.
- **AC-5:** WHEN an analyzed file contains a static import, dynamic import, or
  `require` of a framework's marker specifier, THE SYSTEM SHALL include that
  framework even when the dependency is absent from `package.json`.
- **AC-6:** WHEN no marker matches, THE SYSTEM SHALL report `frameworks: []`.
- **AC-7:** WHEN several markers match, THE SYSTEM SHALL report each matching
  framework exactly once, sorted alphabetically.
- **AC-8:** WHEN `package.json` at packageRoot is unreadable or unparseable, THE
  SYSTEM SHALL add a `skippedChecks` entry with `check: "framework-detection"` and
  continue detection from code markers.
- **AC-9:** WHEN a registered rule declares required frameworks, THE SYSTEM SHALL
  run it only when every declared framework is detected.
- **AC-10:** WHEN a rule declares no frameworks, THE SYSTEM SHALL run it regardless
  of detection results.
- **AC-11:** WHEN config sets a severity for a pack rule whose framework is not
  detected, THE SYSTEM SHALL accept the config (no exit 2) and not run the rule.
- **AC-12:** WHEN `dependencies` or analyzed imports contain only non-marker
  packages (`@nestjs/cli`, `@nestjs/testing`, `@types/express`, `fastify-plugin`,
  `@fastify/*`), THE SYSTEM SHALL NOT activate any framework.
- **AC-13:** WHEN the same tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports including `frameworks`.
- **AC-14:** WHEN a scan completes, THE SYSTEM SHALL render frameworks in the JSON
  report without changing `schemaVersion`, exit codes, or the jsonl shape.

## Testing strategy (TDD)

- Unit `tests/unit/framework/detect.test.ts` — pure detection on temp trees:
  each matrix cell (AC-1..5), empty result (AC-6), dedup + sorting (AC-7),
  unreadable/malformed `package.json` (AC-8), non-marker packages (AC-12),
  require/dynamic-import forms. No committed fixtures needed — temp trees with a
  synthetic `package.json` and small `.ts` files; the detection input is the
  packageRoot plus parsed files, both cheap to stage.
- Unit `tests/unit/engine/runner.test.ts` (extend) — fixture rules declaring
  `frameworks` (same spy pattern as the existing gate tests): gate respected
  (AC-9), unconditional rules unaffected (AC-10).
- Integration `tests/integration/scan.test.ts` (extend) — `runScan` on a temp
  project with an `express` dependency: `projects[0].frameworks` equals
  `["express"]`; malformed `package.json` → `skippedChecks` entry plus
  code-marker fallback (AC-8 end to end).
- e2e `tests/e2e/framework.test.ts` (new) — bin against a temp app: json
  `projects[].frameworks`; config naming a Nest rule id accepted on a non-Nest
  tree without exit 2 (AC-11); byte-identical repeat runs (AC-13). The bad-app
  deep-equal in `tests/e2e/scan-engine.test.ts:52-61` already pins
  `frameworks: []` (AC-6) and needs no change — bad-app declares no dependencies
  and imports nothing.

## Open questions for review

1. **Which `package.json` fields count as "declared"?** Recommendation: the
   `dependencies` object only — precision-first (constitution §2); real apps put
   the marker packages in runtime deps, and misdeclared projects are still caught
   by code markers. Alternative: union with `devDependencies` (catches dev-server
   setups, but over-activates on repos that test several frameworks — e.g. an
   eval corpus repo with express in devDeps for fixtures).
2. **Framework id strings** — contract values consumers will branch on.
   Recommendation: `"nest"`, `"express"`, `"fastify"`, `"prisma"` (short lowercase;
   matches the PLAN wording). react-doctor's report has a singular `framework`
   string; we keep the plural `frameworks` array already fixed in spec 003
   (Nest + Prisma coexist in one app).
3. **Nest code-marker scope.** Recommendation: the allowlist in the matrix
   (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-*`). A blanket `@nestjs/*`
   prefix would let `@nestjs/testing` imports in `*.spec.ts` files activate the
   Nest pack on non-Nest projects (false activation, constitution §2). Alternative:
   whole `@nestjs/*` prefix with a denylist.
4. **Pretty reporter** — add one `Frameworks: nest, prisma` line under
   `Directory:`? Recommendation: yes — additive, one line, keeps the terminal
   report self-explanatory; JSON-only would hide the feature from the primary
   audience (backend developer). Alternative: JSON-only in F004.
5. **Manual gate override** (e.g. a config field to force a pack on). Recommendation:
   none in F004 — the gate is derived only from detection; a config field would be
   new contract surface for a need nobody has expressed (boring surface,
   constitution §10). Alternative: additive `frameworks` config field later.
6. **New dependencies:** none — `package.json` parsing is `JSON.parse`; code
   markers go through the existing parser adapter, which grows a module-specifier
   accessor (adapter grows first, constitution §4).
