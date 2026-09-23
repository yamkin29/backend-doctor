# Contributing to backend-doctor

Thanks for your interest in improving backend-doctor! This document covers
the development setup and the project's working rules. The non-negotiable
principles live in [docs/constitution.md](docs/constitution.md); the full
design history of every shipped feature lives in
[docs/specs/](docs/specs/) — reading a spec is the fastest way to understand
why the code looks the way it does.

## Development setup

- Node.js ≥ 20 (22 recommended), [pnpm](https://pnpm.io) 12.
- `pnpm install` — install dependencies.
- `pnpm build` — build the CLI to `dist/` (tsup).

## Everyday commands

```sh
pnpm test        # vitest; globalSetup builds the bin first — expect a pause
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome check .
pnpm format      # biome check --write . (rewrites files — re-read what you edited)
pnpm docs:rules  # rule-docs ↔ registry drift check
```

Run `pnpm format` before every commit, then `pnpm lint`. Tests are
deterministic — byte-stable output assertions are part of the suite, so if a
snapshot changes, that is a deliberate contract change and belongs in the
commit message.

## Adding a rule

Every rule follows [constitution](docs/constitution.md) §3 — a rule is not
done unless it has all of:

1. An entry in the registry (`src/rules/` for file rules, project rules in
   the graph/prisma packs), with a stable kebab-case id
   (`backend-doctor/<rule-name>`), a category, and a default severity.
   New rules start as `warn`, never `error`.
2. `valid/` and `invalid/` fixtures under
   `tests/fixtures/backend-doctor/<rule-id>/` plus snapshot tests pinning the
   exact diagnostics (file, line, column, message).
3. A markdown doc at `docs/rules/backend-doctor/<rule>.md` — scaffold it
   with:
   ```sh
   pnpm build && node dist/scripts/rule-docs.js --scaffold backend-doctor/<rule-id>
   ```
   The drift gate (`pnpm docs:rules`, also run by the test suite) fails CI on
   a missing doc, wrong metadata, or an orphan doc.

Precision over recall (constitution §2): a rule must produce **zero**
diagnostics on the clean eval application (`evals/nest-good/`). A rule that
cries wolf gets fixed or demoted before it ships.

## Feature workflow

Features go through Spec-Driven Design: `spec.md` (problem, goals, non-goals,
EARS acceptance criteria) → review → `design.md` + `tasks.md` → tasks
implemented in TDD order (failing test first). See
[docs/HOW_TO_WRITE_A_SPEC.md](docs/HOW_TO_WRITE_A_SPEC.md) and any directory
under [docs/specs/](docs/specs/) for real examples. For a bug fix or a doc
improvement this is overkill — a focused PR with a regression test is
perfect.

## Commits and pull requests

- Commit message: `feat(scope): summary` (also `fix`, `chore`, `docs`),
  with a body explaining the why. Feature work references the task, e.g.
  `T4 of spec 023 — …`.
- Every acceptance criterion of a change needs a test. If you touched
  `src/`, `pnpm test` must be green and any new behavior pinned.
- Stable contracts — CLI exit codes (0/1/2), the JSON report
  `schemaVersion`, config file names and precedence, rule ids of shipped
  diagnostics — do not change without prior discussion (constitution §5).
- New runtime dependencies need a rationale in the PR
  (constitution-level decision).

## Reporting issues

- A rule flags correct code? Open a **false positive** report — precision
  bugs are treated as the highest-priority kind.
- The CLI crashes or misbehaves? A **bug report** with the exact command and
  output (deterministic output means your bytes reproduce our run).
- Missing coverage? Propose a **rule**.
- Something exploitable? See [SECURITY.md](SECURITY.md) — please do not
  open a public issue.
