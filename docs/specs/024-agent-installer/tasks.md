# Tasks 024 — Agent skill installer (F024)

TDD order: the pure core first (unit tests over temp trees with injected
roots), then the CLI wiring (e2e through the bin), then docs, then close-out.

## Tasks

- [x] **T1. Installer core (AC-1..AC-4, AC-6..AC-8).** RED:
  `tests/unit/cli/install-command.test.ts` — fresh project install, up-to-date
  no-op, drift refusal + `--force` clean replace, detection report (snapshot +
  no-write tree fingerprint), global scope with injected home, missing source
  fails loud, deterministic stdout. GREEN: `src/cli/commands/install.ts` —
  target table, `import.meta.url` source resolver, folder equality, recursive
  copy, report; `installCommand(opts, roots)` with defaults from
  `process.cwd()`/`os.homedir()`/the package itself.
- [x] **T2. CLI wiring (AC-1..AC-6 e2e).** RED:
  `tests/e2e/install-command.test.ts` — through the built bin with isolated
  `cwd`/`HOME`: happy path, up-to-date, drift + `--force`, detection, unknown
  agent (exit 2, choices on stderr), global scope. GREEN: `install` command in
  `src/cli/run.ts` with `.choices()` validation.
- [x] **T3. README (agents section).** No TDD — docs; command correctness is
  covered by T1/T2, live execution recorded in T5. `backend-doctor install`
  becomes the primary path with the manual `cp` as fallback.
- [x] **T4. Version 0.1.2.** No TDD — release config for the next publish.
- [x] **T5. Live verification.** Run the `prepublishOnly` chain; execute the
  README agents-section commands verbatim (install variants against isolated
  HOME/cwd); record outputs below.
- [x] **T6. Close-out.** Check boxes; record deviations; spec status →
  `Implemented`; `docs/PLAN.md` F024 → `Done`. User publishes 0.1.2.

## Deviations & notes

- None against the spec. Green-phase refinements were test-side only: the
  up-to-date message is "Up to date:" (capital, matching "Created"/"Updated"),
  the drift stderr names the target directory (not the word "target"), and
  the detection-report assertions match agent ids at line starts (paths
  contain `.codex`/`.claude` too). The skill source resolver lives in
  `src/cli/install-source.ts` — two levels below the package root in both the
  repo and published layouts, the `resolveVersion()` precedent — so the
  default source resolves identically from src (vitest), the bundled bin,
  global installs and the npx cache.

## T5 — recorded outputs (2026-09-23)

- **prepublishOnly chain:** lint (0 warnings), typecheck clean, vitest
  70 files / 749 tests, build success — all green (see session report).
- **`backend-doctor install` (no flags, fresh temp dir):** aligned detection
  report — `Skill source: …/skills/backend-doctor/`, four rows
  (`claude-code|codex` × `project|global`) all `absent`, exit 0, no writes.
- **`install --agent claude-code`:** `Created <cwd>/.claude/skills/backend-doctor`,
  exit 0; `SKILL.md` present.
- **re-run:** `Up to date: <target>`, exit 0.
- **drift + `--force`:** refusal exit 2 on stderr with target dir, source dir
  and the `--force` hint, stdout empty, target untouched; then `Updated`,
  exit 0, target equals the shipped skill.
- **`install --agent codex --scope global`** with isolated HOME: created under
  `$HOME/.codex/skills/backend-doctor/SKILL.md`, nothing under cwd, exit 0.
- **`install --agent nope`:** commander usage error on stderr with
  `Allowed choices are claude-code, codex.`, exit 2.
