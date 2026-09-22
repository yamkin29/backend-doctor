# Tasks 023 — npm publish & README (F023)

TDD order: package-contract pins first (they fail on today's `package.json`),
then the static files they reference, then the pack outcome pin, then manual
verification, close-out last.

## Tasks

- [ ] **T1. Publish scripts pin (AC-2, AC-7).** RED:
  `tests/unit/package-contract.test.ts` asserts `scripts.prepublishOnly` equals
  `"pnpm lint && pnpm typecheck && pnpm test && pnpm build"` and
  `scripts.docs:rules` equals `"node dist/scripts/rule-docs.js --check"`.
  GREEN: add both scripts to `package.json`.
- [ ] **T2. Metadata pin (Contract).** RED: the same unit test asserts
  `author`, `repository.url`, `homepage`, `bugs.url` and the `keywords` array
  exactly (coordinates `yamkin29/backend-doctor`, OQ-4/5 resolutions). GREEN:
  add the fields to `package.json`.
- [ ] **T3. LICENSE + README (AC-6 content).** No TDD — static content;
  existence is pinned mechanically by T4's file list, command correctness is
  verified live in T5. Write the MIT LICENSE text (copyright per OQ-5) and the
  README (structure per design decision 6: install, scan, formats/exit codes,
  config, rules + docs location, CI, probe, agent integration, determinism and
  precision claims, license).
- [ ] **T4. Packed-contents pin (AC-1).** RED:
  `tests/e2e/pack.test.ts` runs `npm pack --dry-run --json` at the repo root
  and asserts the sorted `files[].path` list equals the pinned constant.
  GREEN: replace `files: ["dist"]` with the explicit list from design decision 1
  so the actual pack matches the pin (test first: with today's `files` the pack
  contains `dist/scripts/*` and lacks `docs/rules` — the assertion fails).
- [ ] **T5. Live verification (AC-2, AC-3, AC-6, AC-7).** No TDD — manual
  procedure, outputs recorded below: run the `prepublishOnly` chain verbatim;
  pack the tarball (`npm pack`), install it into a temp dir, diff
  `--version` / `rules list` / `scan --format jsonl` on an eval corpus app
  against the repository-built bin; execute every command shown in the README;
  run `pnpm docs:rules`.
- [ ] **T6. Close-out.** Check off tasks; record deviations; spec status →
  `Implemented`; `docs/PLAN.md` F023 → `Done`. Note the user-side handoff:
  rename the GitHub repo to `yamkin29/backend-doctor` (OQ-4), then run
  `npm publish` (OQ-1); AC-5 is checked after that.

## Deviations & notes

- (none yet)

## T5 — recorded outputs

- (pending)
