# Tasks 022 — Eval corpus & precision gate

Order: config-only first, then RED→GREEN clusters (data the tests import —
goldens — come before the tests that pin against live scans), close-out last.

## Tasks

- [ ] **T1. Corpus scaffolding + Biome exclusion (AC-9).** No TDD — pure
  config. GREEN: `biome.json` gains `"!evals"`; `evals/nest-good/package.json`
  and `evals/nest-bad/package.json` exist (dependency keys per design §Good/
  Bad shape); `evals/nest-bad/.env` created and staged with `git add -f`.
  Verify `pnpm lint` stays green with `evals/` present.

- [ ] **T2. Good app + precision gate (AC-1, AC-2, AC-7-good).**
  RED: `tests/e2e/eval-corpus.test.ts` good-app block — zero diagnostics,
  exit 0, empty stderr, frameworks `["nest","prisma"]`, `complete`, empty
  `skippedChecks`, golden `projects[]` shape, byte-identical double scan;
  `tests/e2e/goldens/eval-corpus.ts` carries the good `analyzedFiles` list.
  GREEN: author `evals/nest-good/src/**` (12 files per design) until the gate
  is green — the corpus is the implementation; no rule changes.

- [ ] **T3. Bad app + golden pinning (AC-3, AC-4, AC-5, AC-6, AC-7-bad).**
  RED: bad-app tests — exit 0, diagnostics deep-equal the golden set, every
  registered rule id present in the corpus union, jsonl line count + key
  order, projects[] shape, byte-identical double scan. Seed the goldens as
  empty, capture the actual normalized diagnostics from a live scan, pin them
  in report order, then drive the corpus until the set is exact and coverage
  is complete (firing-site table in design). GREEN: `evals/nest-bad/src/**`
  authored; goldens pinned.

- [ ] **T4. Probe blocking check (AC-8).** RED: e2e probe test —
  `runCliAsync(["probe", "--out", tmp, "--", "node", "scripts/blocking.cjs"])`
  with cwd = `evals/nest-bad`, expecting exit 0 and `findings.json` with
  `blocking.count >= 1`, `calls[0].file === "scripts/blocking.cjs"`, and no
  `.backend-doctor/` inside the corpus tree. GREEN: author the
  dependency-free `scripts/blocking.cjs` (pbkdf2Sync work, per design
  decision 5).

- [ ] **T5. Close-out.** Check off tasks; record deviations; spec status →
  `Implemented`; `docs/PLAN.md` F022 → `Done`. Full verification
  (test/typecheck/lint/format) and a live CLI smoke run.

## Deviations & notes

- (recorded during implementation)
