# Design 024 — Agent skill installer (F024)

Status: written after spec approval (2026-09-23). All four open questions
resolved by adopting the recommendations (see spec.md → Open questions).

## Module layout

| File | Purpose |
|------|---------|
| `src/cli/commands/install.ts` | the whole feature: target table, source resolver, folder comparison, copy, detection report; pure-injectable core (`installCommand(opts, roots)`) |
| `src/cli/run.ts` | wires the `install` command (choices-validated `--agent`/`--scope`, `--force`) |
| `tests/unit/cli/install-command.test.ts` | AC-1..AC-4, AC-6..AC-8 over temp trees with injected roots |
| `tests/e2e/install-command.test.ts` | AC-1..AC-6 through the built bin with isolated `cwd`/`HOME` |
| `README.md` | "For coding agents": `backend-doctor install` primary, manual `cp` fallback |
| `package.json` | version → 0.1.2 (close-out) |

## Key decisions

1. **Top-level `install` command, not nested.** Spec 017's non-goal phrased
   the future as `npx backend-doctor install`; "skills install" would add
   command depth for a single artifact (constitution §10). Alternative
   rejected: nesting under `ci` (wrong domain — this is an editor/agent
   concern) or `rules` (unrelated).
2. **Source resolved via `import.meta.url`, not `require.resolve`.**
   `fileURLToPath(new URL("../../skills/backend-doctor/", import.meta.url))`
   resolves correctly from `src/cli/commands/` (vitest), from the bundled
   `dist/bin/backend-doctor.js`, from global installs and from the npx
   cache — one rule, no self-name dependency. Alternative
   (`require.resolve("backend-doctor-cli/package.json")`) breaks if the
   package is consumed under a different name and pulls module-resolution
   semantics in for no gain.
3. **Whole-folder copy and whole-folder equality.** The comparison walks both
   trees (relative paths + byte contents). Alternative — comparing only
   SKILL.md — rejected: extra or removed companion files would go unnoticed.
   Copying the folder (not just the file) future-proofs reference files.
4. **`--force` = clean replace (`rmSync` + `cpSync`), not in-place overwrite.**
   An in-place copy leaves files that were deleted from the source; a clean
   replace guarantees the target is exactly the shipped skill.
5. **No-flag run is a detection report with zero writes** (OQ-2). Mirrors
   `scan --dump-config`: the observable-by-default philosophy. The report is
   computed, then printed — never printed row by row while writing.
6. **Unknown `--agent`/`--scope` never reach the command function.** Commander
   `.choices()` validates and prints the allowed values to stderr with exit 2
   (the `scan --format` precedent) — AC-5 holds at the parse layer.
7. **Drift refusal is exit 2 with both paths on stderr and clean stdout**
   (OQ-4; constitution §5: usage/environment errors are 2; stdout purity on
   failure per the `init`/`ci install` precedent).
8. **Folder equality ignores nothing.** If future skill files gain irrelevant
   variance (e.g. timestamps inside files), the comparison stays honest —
   the shipped skill is static content by design.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | unit `installs fresh into the project scope` + e2e `creates the skill in the project scope` |
| AC-2 | unit `reports up-to-date without writing` + e2e |
| AC-3 | unit `refuses drift …` / `--force replaces cleanly` + e2e |
| AC-4 | unit `detection report` (stdout snapshot + tree fingerprint unchanged) + e2e |
| AC-5 | e2e `rejects an unknown agent` (commander stderr, clean stdout) |
| AC-6 | unit `targets the injected home for global scope` + e2e `installs into isolated HOME` |
| AC-7 | unit `fails loud when the skill source is missing` |
| AC-8 | unit `detection output is deterministic` (two runs byte-equal) |

## Dependencies

None added. `fs.cpSync`/`fs.rmSync` are Node ≥ 16.7 APIs; the floor is 20.
