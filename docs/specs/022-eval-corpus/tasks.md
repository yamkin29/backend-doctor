# Tasks 022 — Eval corpus & precision gate

Order: config-only first, then RED→GREEN clusters (data the tests import —
goldens — come before the tests that pin against live scans), close-out last.

## Tasks

- [x] **T1. Corpus scaffolding + Biome exclusion (AC-9).** No TDD — pure
  config. GREEN: `biome.json` gains `"!evals"`; `evals/nest-good/package.json`
  and `evals/nest-bad/package.json` exist (dependency keys per design §Good/
  Bad shape); `evals/nest-bad/.env` created and staged with `git add -f`.
  Verify `pnpm lint` stays green with `evals/` present.

- [x] **T2. Good app + precision gate (AC-1, AC-2, AC-7-good).**
  RED: `tests/e2e/eval-corpus.test.ts` good-app block — zero diagnostics,
  exit 0, empty stderr, frameworks `["nest","prisma"]`, `complete`, empty
  `skippedChecks`, golden `projects[]` shape, byte-identical double scan;
  `tests/e2e/goldens/eval-corpus.ts` carries the good `analyzedFiles` list.
  GREEN: author `evals/nest-good/src/**` (12 files per design) until the gate
  is green — the corpus is the implementation; no rule changes.

- [x] **T3. Bad app + golden pinning (AC-3, AC-4, AC-5, AC-6, AC-7-bad).**
  RED: bad-app tests — exit 0, diagnostics deep-equal the golden set, every
  registered rule id present in the corpus union, jsonl line count + key
  order, projects[] shape, byte-identical double scan. Seed the goldens as
  empty, capture the actual normalized diagnostics from a live scan, pin them
  in report order, then drive the corpus until the set is exact and coverage
  is complete (firing-site table in design). GREEN: `evals/nest-bad/src/**`
  authored; goldens pinned.

- [x] **T4. Probe blocking check (AC-8).** RED: e2e probe test —
  `runCliAsync(["probe", "--out", tmp, "--", "node", "scripts/blocking.cjs"])`
  with cwd = `evals/nest-bad`, expecting exit 0 and `findings.json` with
  `blocking.count >= 1`, `calls[0].file === "scripts/blocking.cjs"`, and no
  `.backend-doctor/` inside the corpus tree. GREEN: author the
  dependency-free `scripts/blocking.cjs` (pbkdf2Sync work, per design
  decision 5).

- [x] **T5. Close-out.** Check off tasks; record deviations; spec status →
  `Implemented`; `docs/PLAN.md` F022 → `Done`. Full verification
  (test/typecheck/lint/format) and a live CLI smoke run.

## Deviations & notes

- **Spec correction at approval (pre-implementation):** the draft said
  "42 registered rules"; the registry and `docs/rules/` carry 41 (35 AST +
  6 project). Spec text corrected; AC-5 always said "every registered rule".
- **T2 — engine defect surfaced by the corpus (constitution §2 defect):**
  the import-graph resolver treated Nest-idiomatic dotted stems
  (`./app.module`) as extensions via `path.extname`, so NO edge in a clean
  Nest app resolved — the first good-app run produced 23
  `unused-file`/`unused-export` false positives. Fix: `candidatePaths`
  (`src/engine/imports.ts`) appends the supported extensions for any
  extension not in the known set (`.ts/.tsx/.mts/.cts/.js/.mjs/.cjs`),
  instead of only for the empty one. RED→GREEN unit test added to
  `tests/unit/engine/imports.test.ts`; durable lesson recorded in
  `docs/RESEARCH.md`. This is a graph-resolver fix, not a rule or contract
  change (no registry, exit-code, or schema impact).
- **T3 — `no-god-service` on `OrdersService` was an authoring accident:**
  the workhorse service reached the 12-public-method threshold. Fixed by
  making helper methods private (per-file rules ignore visibility), leaving
  the deliberate god-service firing on `DashboardService` only.
- **T3 — `circular-dependency` reports per cycle member:** the
  orders/inventory pair yields 2 diagnostics (one per file), not 1 per
  cycle. Pinned as-is; the design's "exact counts land with the golden
  pinning" note covers it.
- **T3 — authoring traps verified live (as designed):** any
  class-validator/zod import silences `env-without-validation` (bad DTOs
  authored import-free, suffix-recognized); a local `merge` binding shadows
  the unsafe-merge rule's bare-name match (removed); module-API rules
  match property-form callees (`fs.readFileSync`, `crypto.pbkdf2Sync`,
  `cp.exec`) safely against the shadow check.
- **Pre-existing lint warning (not this feature):**
  `src/runtime/load.ts` carries an unused `FINDINGS_VERSION` constant from
  spec 021; `biome check` exits 0 (warning only). Left untouched — outside
  this feature's scope.
