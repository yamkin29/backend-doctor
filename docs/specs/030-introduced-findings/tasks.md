# Tasks 030 — Introduced findings

- [x] **T1. Match source occurrences (AC-2–4, AC-14, AC-19–20).** RED: parser anchor and matcher tests. GREEN: parser-backed anchors and deterministic one-to-one matching, with unchanged-line preference. REFACTOR: keep matching pure and parser access isolated.
- [x] **T2. Read baseline snapshots (AC-5–11, AC-15).** RED: real Git snapshot/comparison integration tests. GREEN: baseline/ref resolution, tracked regular-file snapshots, rename pairing, inert config and visible failures. REFACTOR: centralize cleanup/path normalization.
- [x] **T3. Integrate scan/report/CLI (AC-1, AC-12–14, AC-16–18).** RED: CLI, report, runtime and console coverage tests. GREEN: introduced option, orchestration before runtime merge, partial coverage and unchanged existing contracts. REFACTOR: keep CLI dispatch thin.
- [x] **T4. Verify and close out (all ACs).** Run relevant tests, live CLI/terminal smoke, pnpm test/typecheck/format/lint, inspect formatting changes, update docs/research, check tasks, mark spec Implemented and roadmap Done.

## Deviations & notes

- Work occurs on `codex/introduced-findings`, as requested by the user.
- Scope approval comes from the user's 2026-10-18 acceptance of the concrete proposal;
  approval is not requested a second time for the same behavior.
- Source anchors walk parsed syntax rather than a context-free scanner. A failing
  regression showed that regex character classes can otherwise be mistaken for
  comment trivia. This stays behind the parser boundary.
- An unborn introduced scan includes index entries as well as untracked files.
  Existing scope behavior is preserved; the new scope's staged-file regression
  caught the distinction between `ls-files --cached` and `--others`.
- Git-detected renames reserve their baseline path, so recreating the old path
  cannot reuse historical occurrences. The regression failed before this fix.
- Baseline context/metadata failures conservatively preserve all current candidates
  for that comparison, with a visible notice. No partial baseline is used as proof.
- Current file filters apply before pairing; renamed historical paths are not
  independently excluded by their old spelling. Snapshot source selection is
  explicit, and all rule/severity settings come from current effective config.

## Verification — 2026-10-18

- `pnpm test`: **88 files, 848 tests passed**. The first sandboxed attempt exposed
  HTTP `listen EPERM` restrictions; the final full runs passed with permission to
  bind local test servers outside the sandbox.
- `pnpm typecheck`: passed.
- `pnpm format`: passed; changed files re-read after formatting.
- `pnpm lint`: passed.
- `git diff --check` and local documentation link/content review: passed.
- Live CLI smoke: a temporary committed repository contained an old eval finding;
  inserting a comment and adding a new eval reported only `sample.ts:3`, with exit
  `0`, schema version `1`, and empty stderr.
- Live interactive PTY smoke: observed the baseline stage, introduced-mode result,
  unavailable partial-scan score, source details at line 3, coverage/skipped rules,
  navigation, and clean `q` exit with cursor restoration.
- No Prisma interception or rule implementation changed; `pnpm test:prisma` and
  rule fixture/doc regeneration were not required.
