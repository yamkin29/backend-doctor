# Spec 023 — npm publish & README (F023)

- **Status:** Approved
- **Phase:** 6 — Quality & release
- **Depends on:** F001–F021 (all Done — the shipped surface: CLI, config,
  engine, 41 rules, GitHub Action, agent artifacts, runtime probe, combined
  report); F017 (Done — hands packaging of the rule docs and the publish
  surfaces to this spec); F022 (Done — the eval gate the README's precision
  claims stand on)
- **Blocks:** — nothing downstream in PLAN; externally, SKILL.md's
  `npx backend-doctor@latest` guidance and the F016 composite action's
  `npm install -g backend-doctor@<version>` path activate at publish

## Problem

The analyzer is feature-complete — 41 registered rules in 8 categories,
config, CI integration, runtime probe, and an eval corpus whose clean app
produces zero diagnostics (F022) — but it has never been published:
`npm view backend-doctor` returns 404 (verified live, 2026-09-22).
SKILL.md teaches `npx backend-doctor@latest …` and the F016 action installs
the package from npm; both stay dead until the package exists. There is no
README, so the eventual npm page would be empty, and no LICENSE file although
`package.json` declares `"license": "MIT"`. The tarball contents have never
been pinned: `npm pack --dry-run` today reports 8 files, including
`dist/scripts/rule-docs.js` (95 kB of maintainer tooling whose fate spec 017
explicitly deferred — "whether it ships inside the published npm tarball is
F023's packaging decision", repeated in a `tsup.config.ts` comment), while
`package.json` lacks `repository`/`homepage`/`bugs`/`keywords`/`author`.

No new runtime or dev dependencies are needed for any of this.

## Goals

- **README.md** at the repo root (auto-shipped by npm): what the tool is,
  install (`npx backend-doctor@latest`), quick start (`scan`), the config
  file, output formats and exit codes, a rules overview with the location of
  the per-rule docs, GitHub Action (`ci install`), runtime `probe`, agent
  integration (SKILL.md, jsonl), determinism/privacy guarantees, and
  precision claims grounded in the F022 gate. Every command the README shows
  is executed verbatim before close-out.
- **Publish-ready package metadata:** LICENSE file (MIT text),
  `repository`/`homepage`/`bugs`, `keywords`, `author`; `files` pinned to the
  intended tarball contents (decisions OQ-2/OQ-3).
- **Publish gate:** a `prepublishOnly` script running lint → typecheck →
  tests → build, so a red or stale tree cannot be packed (constitution §8:
  fail loud).
- **Packed-contents contract:** a CI test pins the exact tarball file list
  via `npm pack --dry-run --json`; any packaging drift fails `pnpm test`.
- **The published package:** `npm publish` executed (by whom — OQ-1), then
  the registry state verified by installing the package in a fresh directory
  and running the CLI end-to-end.
- **Rule-docs tooling wired as a repo workflow:** an npm script alias
  `docs:rules` for the existing F017 check runner (`node
  dist/scripts/rule-docs.js --check`).

Scope note on the PLAN wording "rule docs generation script": F017 already
delivered it — `src/scripts/rule-docs.ts` built to `dist/scripts/rule-docs.js`
with `--check`/`--scaffold` and a CI drift gate; spec 017's open questions
were resolved as "F017 delivers the rule-docs drift gate plus the scaffold,
F023 keeps only packaging/publish concerns". What remains here is packaging
the docs (OQ-3) and the alias above — no new doc tooling.

## Non-goals

- **Agent installer** (`npx backend-doctor install` copying the skill into
  Claude Code/Cursor/Codex configs) — not in the PLAN line; would need its
  own line.
- **`rules explain --doc` / printing doc bodies / changing the `Docs:` output
  line** — spec 017 resolved that F023 keeps packaging and publish concerns;
  `explain` stays path-only.
- **Canonical per-rule docs URLs in CI PR comments** (spec 016 anticipated
  them "with F017/F023") — nothing in `src/ci` references docs today, and
  stable URLs depend on the final repository name (OQ-4); a future feature
  owns comment links if wanted.
- **Docs website** — PLAN §6 out-of-scope.
- **Engine v2 (ParserAdapter → oxc-parser)** — its own Planned roadmap line.
- **GitLab CI, TypeORM/Mongoose packs, LLM-assisted checks** — PLAN §6.
- **New rules, severity changes, config fields, report schema or
  `schemaVersion` changes, exit-code changes, CLI flag changes** — none.
- **Renaming the GitHub repository itself** — a user action on GitHub; this
  spec only decides which coordinates the package metadata names (OQ-4).

## User stories

1. **Backend developer** — finds the package on npm; the README walks them
   from `npx backend-doctor@latest scan` through a starter config to the doc
   of the rule that fired; the npm page shows license and repository links.
2. **CI author** — the F016-generated workflow's `npm install -g
   backend-doctor@<version>` now resolves against a real package; `engines`,
   `license` + LICENSE, and repository metadata are present and truthful;
   `files` guarantees no maintainer tooling leaks into installs.
3. **AI agent** — SKILL.md's `npx backend-doctor@latest scan --scope changed
   --format jsonl` works against the published package; if OQ-3 ships the
   docs, the installed package carries `docs/rules/backend-doctor/*.md`, so
   the path printed by `rules explain` resolves relative to the package root.

## Contract / Model

`package.json` after this feature (unchanged fields omitted):

```jsonc
{
	// "name": "backend-doctor" — unchanged; free on npm (verified 2026-09-22)
	"version": "0.1.0", // OQ-5: publish as-is
	"license": "MIT", // unchanged; now backed by a LICENSE file
	"author": "…", // OQ-5 (identity)
	"repository": {
		"type": "git",
		"url": "git+https://github.com/<owner>/<repo>.git", // OQ-4
	},
	"homepage": "https://github.com/<owner>/<repo>#readme", // OQ-4
	"bugs": { "url": "https://github.com/<owner>/<repo>/issues" }, // OQ-4
	"keywords": [
		"nestjs",
		"nodejs",
		"backend",
		"static-analysis",
		"lint",
		"prisma",
		"code-quality",
	],
	// exact pinned list per decisions OQ-2/OQ-3; today's dist layout is
	// dist/bin, dist/index.js, dist/index.d.ts, dist/probe, dist/scripts
	"files": ["…"],
	"scripts": {
		"docs:rules": "node dist/scripts/rule-docs.js --check",
		"prepublishOnly": "pnpm lint && pnpm typecheck && pnpm test && pnpm build",
	},
}
```

- The tarball must contain exactly (the set the pin test enforces):
  `package.json`, `README.md`, `LICENSE`, `dist/bin/backend-doctor.js`,
  `dist/bin/backend-doctor.d.ts`, `dist/index.js`, `dist/index.d.ts`,
  `dist/probe/register.cjs`, and — only per the open questions —
  `docs/rules/backend-doctor/*.md` (41 files, OQ-3) and
  `dist/scripts/rule-docs.{js,d.ts}` (OQ-2). Nothing else.
- `bin`, `exports`, `engines` (`node >= 20`), config file names, CLI exit
  codes (0/1/2), report `schemaVersion`: untouched.
- Publishing mechanics: unscoped package → public access by default; publish
  from a clean git tree; the documented command is `npm publish`.
- README language: English; no badges; no invented numbers — performance or
  precision claims only what the F022 gate demonstrates (zero diagnostics on
  the clean eval corpus); no exact rule count (drift-prone; the README points
  at `backend-doctor rules list` instead).

## EARS acceptance criteria

- **AC-1** WHEN `npm pack --dry-run --json` runs at the repo root with dist
  built THE SYSTEM SHALL report exactly the pinned file set from the Contract
  section, and the pinning test SHALL fail on any extra or missing file.
- **AC-2** WHEN `prepublishOnly` runs THE SYSTEM SHALL execute lint,
  typecheck, tests and build in that order and SHALL abort with the failing
  tool's non-zero exit if any step fails.
- **AC-3** WHEN the built tarball is installed into a fresh directory and
  `backend-doctor --version`, `rules list`, and `scan --format jsonl` run
  against an eval corpus app THE SYSTEM SHALL produce output byte-identical
  to the repository-built bin for the same commands (version string, rule
  listing, diagnostics lines).
- **AC-4** WHEN the existing rule-docs drift gate and SKILL.md guard test run
  THE SYSTEM SHALL pass unchanged — packaging adds no drift to `docs/rules/`
  content or `skills/`.
- **AC-5** WHEN the npm registry is queried after publish (`npm view
  backend-doctor …`) THE SYSTEM SHALL report the version from `package.json`,
  the MIT license, a README rendered from this repo's README.md, and the
  repository/homepage coordinates chosen in OQ-4.
- **AC-6** WHEN a reader executes any command shown in the README verbatim
  THE SYSTEM SHALL behave as the README states — verified by running every
  README command live before close-out (install, scan with
  `--format`/`--scope`, exit codes 0/1/2, `init`, `rules list`/`explain`,
  `ci install`, `probe`).
- **AC-7** WHEN `pnpm docs:rules` runs at the repo root with a built dist THE
  SYSTEM SHALL print the rule-docs check result with exit 0 on the current
  tree (exit 1 on seeded drift is already covered by the existing runner
  tests).

## Testing strategy (TDD)

- **Pack-pin test (AC-1, CI):** e2e test spawning `npm pack --dry-run --json`
  at the repo root (vitest `globalSetup` builds dist; `npm` ships with node
  on CI runners), asserting the reported `files[].path` list equals a pinned
  constant. Spawned via promisified `execFile` (the `runCliAsync` precedent —
  `spawnSync` deadlocks in-worker servers, RESEARCH spec 016).
- **prepublishOnly pin (AC-2):** unit test asserting `package.json`'s
  `prepublishOnly` equals the exact expected command chain (a real
  failing-gate publish is not runnable in CI). The chain is also executed
  live once at close-out and its output recorded.
- **AC-3 / AC-6 — manual close-out verification** (the F022 live-probe-check
  precedent): install the tarball into a temp dir (npm fetches the runtime
  dependencies from the registry — deliberately not a CI test), run the
  command set, diff against repository-built output, and execute every README
  command; outputs recorded in `tasks.md` and shown in the session report.
- **AC-4 / AC-7:** the existing `tests/unit/rule-docs.test.ts` and the
  SKILL.md guard stay green untouched; the `docs:rules` alias is covered by
  asserting its composed command in `package.json` and running it live.
- No new `tests/fixtures/`; temp dirs only.

## Open questions for review

All five were resolved on approval (2026-09-22) by adopting the
recommendations: (1) the agent prepares and verifies everything; **the user
runs the final `npm publish`**; (2) `dist/scripts/rule-docs.{js,d.ts}` are
**excluded** from the tarball (`files` is an explicit list); (3) `docs/rules/**`
**ship** in the tarball; (4) metadata coordinates name the post-rename
`yamkin29/backend-doctor` (the user renames the GitHub repo at or before
publish); (5) publish `0.1.0` as-is, LICENSE copyright "Copyright (c) 2026
Aleksey Yamkin", `author` "Aleksey Yamkin".

1. **Who executes the final `npm publish`?** (a) I do everything up to and
   including the tarball verification; **you** run `npm publish` from your
   logged-in npm — recommended: the npm account and 2FA/OTP are yours and
   publishing is public and outward-facing. (b) You pre-authorize me to run
   `npm publish` during Phase 2 close-out (requires npm login on this
   machine and your OTP at that moment).
2. **Ship `dist/scripts/rule-docs.js` in the tarball?** (a) Exclude — it is
   maintainer tooling (spec 017: "never advertised in `--help`"), it runs
   from a repo checkout against our docs convention, and excluding removes
   ~95 kB of the ~306 kB unpacked size; `files` becomes an explicit list —
   recommended. (b) Ship it — nobody today consumes it from an install; it
   imports the full rule registry and resolves `docs/rules` relative to the
   process cwd.
3. **Ship `docs/rules/**` in the tarball?** (a) Yes — agents are the primary
   docs consumers per F017; shipping lets them read the exact path
   `rules explain` prints, resolved from the package root; ~60 kB of
   markdown; spec 017 explicitly hands "packaging rule docs into the npm
   tarball" to F023 — recommended. (b) No — docs stay GitHub-only and
   installed users get paths that do not resolve.
4. **Repository coordinates in metadata (repository/homepage/bugs + README
   links).** (a) Post-rename `yamkin29/backend-doctor` — consistent with the
   F016 resolution that baked `yamkin29/backend-doctor@v1` into generated
   workflows; requires you to rename the GitHub repo at or before publish —
   recommended. (b) Current coordinates `yamkin29/Node-doctor`.
5. **Version and identity.** (a) Publish `0.1.0` as-is (0.x honestly signals
   pre-1.0; all contracts already carry `schemaVersion`); LICENSE copyright
   line "Copyright (c) 2026 Aleksey Yamkin"; `author` "Aleksey Yamkin" —
   recommended, provided you confirm you want that name public on npm.
   (b) Bump to `1.0.0` before the first publish. (c) A different
   copyright/author string — tell me the exact text.
