# Tasks 023 — npm publish & README (F023)

TDD order: package-contract pins first (they fail on today's `package.json`),
then the static files they reference, then the pack outcome pin, then manual
verification, close-out last.

## Tasks

- [x] **T1. Publish scripts pin (AC-2, AC-7).** RED:
  `tests/unit/package-contract.test.ts` asserts `scripts.prepublishOnly` equals
  `"pnpm lint && pnpm typecheck && pnpm test && pnpm build"` and
  `scripts.docs:rules` equals `"node dist/scripts/rule-docs.js --check"`.
  GREEN: add both scripts to `package.json`.
- [x] **T2. Metadata pin (Contract).** RED: the same unit test asserts
  `author`, `repository.url`, `homepage`, `bugs.url` and the `keywords` array
  exactly (coordinates `yamkin29/backend-doctor`, OQ-4/5 resolutions). GREEN:
  add the fields to `package.json`.
- [x] **T3. LICENSE + README (AC-6 content).** No TDD — static content;
  existence is pinned mechanically by T4's file list, command correctness is
  verified live in T5. Write the MIT LICENSE text (copyright per OQ-5) and the
  README (structure per design decision 6: install, scan, formats/exit codes,
  config, rules + docs location, CI, probe, agent integration, determinism and
  precision claims, license).
- [x] **T4. Packed-contents pin (AC-1).** RED:
  `tests/e2e/pack.test.ts` runs `npm pack --dry-run --json` at the repo root
  and asserts the sorted `files[].path` list equals the pinned constant.
  GREEN: replace `files: ["dist"]` with the explicit list from design decision 1
  so the actual pack matches the pin (test first: with today's `files` the pack
  contains `dist/scripts/*` and lacks `docs/rules` — the assertion fails).
- [x] **T5. Live verification (AC-2, AC-3, AC-6, AC-7).** No TDD — manual
  procedure, outputs recorded below: run the `prepublishOnly` chain verbatim;
  pack the tarball (`npm pack`), install it into a temp dir, diff
  `--version` / `rules list` / `scan --format jsonl` on an eval corpus app
  against the repository-built bin; execute every command shown in the README;
  run `pnpm docs:rules`.
- [x] **T6. Close-out.** Check off tasks; record deviations; spec status →
  `Implemented`; `docs/PLAN.md` F023 → `Done`. Note the user-side handoff:
  rename the GitHub repo to `yamkin29/backend-doctor` (OQ-4), then run
  `npm publish` (OQ-1); AC-5 is checked after that.

## Deviations & notes

- **npm package renamed to `backend-doctor-cli`** (user decision in chat,
  2026-09-22): the first publish attempt got 403 — npm's typosquatting rule
  normalizes names without hyphens, and `backenddoctor` (dead one-file
  package from 2022) blocks `backend-doctor`. The product identity is
  unchanged (bin command `backend-doctor`, `backend-doctor.config.ts`,
  `.backend-doctor/` storage, rule-id prefix `backend-doctor/*`, SKILL front
  matter); only npm-install surfaces changed: `package.json` name, the
  `npx backend-doctor-cli@latest` invocations in README and SKILL.md (+ the
  spec 017 guard test), the action's `npm install -g backend-doctor-cli@…`,
  and `import { defineConfig } from "backend-doctor-cli"` in the JSDoc, the
  docs scaffold and all 41 rule docs. `docs/PLAN.md` Decisions amended.
  Note: `npm view` returning 404 does NOT mean a name is publishable — the
  similarity check runs server-side at PUT only.
- **tsup programmatic `build()` auto-loads `tsup.config.ts`** (found during
  T4): `tests/globalSetup.ts` called `build({ ...options })` without
  `config: false`, so tsup merged the ARRAY config from the file into the
  inline options and polluted `dist/` on every `pnpm test`: each esm entry
  gained an ESM-code `.cjs` twin, the cjs hook entry gained a `.d.cts`. The
  tsup CLI is immune, so `pnpm test` and `pnpm build` produced different dist
  trees — and would have produced different npm tarballs depending on which
  command ran last. Fixed in `tests/globalSetup.ts` (commit `8fb6cf2`),
  recorded in `docs/RESEARCH.md`. This also explains the stale
  `dist/index.cjs` observed in the work tree before this feature.
- **README: the react-doctor reference was dropped** at the user's request
  (2026-09-22) — the spec's design decision 6 never required it; no spec
  change needed.
- **AC-5 is pending the user's publish step** (OQ-1 resolution): `npm view
  backend-doctor` verification happens after the user renames the repo and
  runs `npm publish`; procedure recorded in the session report.

## T5 — recorded outputs (2026-09-22)

- **prepublishOnly chain, verbatim:** `pnpm lint && pnpm typecheck && pnpm
  test && pnpm build` → exit 0. lint: 1 pre-existing warning
  (`src/runtime/load.ts:14` unused `FINDINGS_VERSION`, out of scope);
  typecheck clean; vitest 68 files / 735 tests passed; tsup build success.
- **Tarball install smoke:** `npm pack` → `backend-doctor-0.1.0.tgz`
  (83 725 B); `npm install <tgz>` into a fresh temp dir → `--version` prints
  `0.1.0`; `rules list` prints `41 rules`; the installed package carries
  `README.md`, `LICENSE`, `dist/` and 41 docs under `docs/rules/backend-doctor/`.
- **Byte-identity (AC-3):** `scan evals/nest-bad --format jsonl` from the
  installed bin vs the repository-built bin → `diff` clean (44 diagnostic
  lines, keys `id,filePath,line,column,rule,category,severity,message,tags`);
  `rules list` → `diff` clean.
- **README commands (AC-6), all as documented:** `scan` pretty on
  `evals/nest-good` → `Summary: 0 errors, 0 warnings (0 issues)`, exit 0 (the
  F022 precision claim, live); `scan --format json` → one `schemaVersion: 1`
  document; `scan --scope changed` on the clean tree → changed-mode header,
  exit 0; `scan --scope files --file src/index.ts` → exit 0;
  `rules explain backend-doctor/no-eval` → metadata block;
  `init` in a temp dir → `Created …/backend-doctor.config.ts`;
  `scan --dump-config` → resolved JSON; `probe --out <dir> -- node
  tests/fixtures/probe/blocking.cjs` → sensitivity warning + session dir
  (exit 1 = the fixture app's own exit code, passed through);
  `probe --duration 5 -- node tests/fixtures/probe/ok.js` → exit 0;
  `scan tests/fixtures/probe --trace <session>` → `Runtime trace:` line,
  6 warnings merged; `ci install` in a fresh `git init` dir → writes
  `.github/workflows/backend-doctor.yml`; `pnpm docs:rules` →
  `rule docs: ok (41 rules, no drift)`, exit 0.
