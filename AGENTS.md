# AGENTS.md — guide for autonomous feature agents

backend-doctor is a deterministic static analyzer for Node.js/NestJS backends (the
backend analog of [react-doctor](https://github.com/millionco/react-doctor)). Single
npm package, CLI `backend-doctor`. Every feature is developed by a dedicated agent
running a full Spec-Driven-Design + TDD cycle. This file is your entry point; it
tells you how to work here without any other conversation context.

## Reading order — do this before writing anything

1. `docs/PLAN.md` — master roadmap, all architecture decisions, feature statuses.
   Your feature is a line in the roadmap table. Do not exceed its scope.
2. `docs/constitution.md` — non-negotiable principles. When your design conflicts
   with the constitution, the constitution wins or you stop and ask.
3. `docs/HOW_TO_WRITE_A_SPEC.md` — mandatory if you are writing a spec.
4. `docs/RESEARCH.md` — precedents adopted from react-doctor, environment findings,
   hard-won gotchas. Check it before solving anything from scratch.
5. The target spec (`docs/specs/NNN-slug/`) and **the actual code** it touches
   (`src/`). Design from facts read in the repository, never from assumptions.

## Standard feature cycle — two dispatches

### Dispatch A — write the spec

1. Pick the next `Planned` feature from `docs/PLAN.md` (or the one named in your
   dispatch prompt). Determine its number: next free `NNN` in `docs/specs/`.
2. Read the code the feature will touch. Verify every assumption against `src/`.
3. Write `docs/specs/NNN-kebab-slug/spec.md` following
   `docs/HOW_TO_WRITE_A_SPEC.md`. Commit the draft.
4. **STOP.** Present the spec summary and its open questions to the user. Do not
   continue to design/implementation until the user approves and answers the open
   questions. Decisions on open questions belong to the user (see "User-owned
   decisions").

### Dispatch B — implement the spec (only after approval)

1. Write `design.md` and `tasks.md` drafts (design decisions + alternatives, test
   map AC→test, TDD-ordered task list). Commit.
2. Implement tasks in order. Every task: **red → green → refactor**. Write the
   failing test first, then the minimal implementation, then cleanup.
3. Commit per green task: `feat(scope): summary` + body line `T<n> of spec NNN…`.
4. Close-out task: check off tasks, record deviations in `tasks.md`, set spec
   status → `Implemented`, set `docs/PLAN.md` feature → `Done`. Commit.

## Verification before every commit

```sh
pnpm test          # vitest; globalSetup builds the bin first — expect a pause
pnpm exec tsc --noEmit
pnpm format        # biome with tabs — run before committing, it rewrites files:
                   # RE-READ any file you edited afterwards (tooling will show it)
pnpm lint
```

In shell chains use `set -o pipefail` — otherwise `cmd | grep | head` masks the
exit code of `cmd` (this has bitten more than once).

## Environment notes

- pnpm 12 is installed globally (plain `pnpm`); Node 22; ESM (`"type": "module"`,
  imports need `.js` extensions in source); TypeScript strict with
  `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (use `import type`).
- Build: `pnpm build` (tsup). The e2e tests spawn the built bin — vitest
  `globalSetup` runs the build automatically.
- Docs, specs, code comments, commit messages: **English**. The user chats in
  Russian; artifacts stay English.

## User-owned decisions — never make these alone

- Amending `docs/constitution.md` (its own header requires explicit approval).
- Adding dependencies (propose in spec open questions).
- Expanding scope beyond the feature's line in `PLAN.md`; adding acceptance
  criteria beyond it.
- Changing stable contracts: CLI exit codes (0/1/2), JSON report `schemaVersion`,
  public `exports`, config file names/precedence.
- Everything listed as an open question in your spec draft.

Everything else — module layout, internal naming, message wording, file structure —
is yours. Prefer the boring option (constitution §10).

## Definition of Done (per feature)

- [ ] All tasks checked in `tasks.md`; every AC has a test (Test map complete).
- [ ] `pnpm test`, typecheck, lint all green; format applied.
- [ ] Every rule (when the feature adds rules) has valid/invalid fixtures,
      snapshot tests and `docs/rules/<rule-id>.md` (constitution §3).
- [ ] `docs/PLAN.md` status updated; spec status → `Implemented`; deviations
      recorded in `tasks.md` — including anything that turned red→green into
      characterization, and any bug found on the way.
- [ ] Live smoke test of the CLI performed and its output eyeballed.

## Hard rules

- Deterministic engine: no LLM/network calls in analysis; byte-identical output for
  identical input (constitution §1).
- Fail loud: no silent fallbacks, no silent skips — skipped work must be visible in
  the report (constitution §8).
- Do not bump `schemaVersion`, do not touch exit codes, do not rename config files.
- If reality contradicts the spec mid-implementation — stop, report to the user,
  record the finding; do not silently redesign.
