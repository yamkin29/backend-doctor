# HOW_TO_WRITE_A_SPEC — the spec skeleton every feature follows

Every feature gets a directory `docs/specs/NNN-kebab-slug/` with three files:
`spec.md`, `design.md`, `tasks.md`. Numbering is zero-padded and sequential
(`001-cli-skeleton`, `002-config`, …). Status lifecycle: `Draft — pending review`
→ (user approval) → `Approved` → (implementation) → `Implemented`.

Sources for a spec, in priority order:

1. The feature's line in `docs/PLAN.md` — this is the scope anchor. Anything beyond
   it goes to Open questions, never into Goals silently.
2. `docs/constitution.md` — principles constrain the design (precision > recall,
   fail loud, deterministic, stable contracts).
3. `docs/RESEARCH.md` — adopted precedents; reuse them instead of inventing.
4. The actual code in `src/` — read it before designing. A spec that contradicts
   the current code without saying so is a defect.

## spec.md skeleton

```markdown
# Spec NNN — <Feature title> (FXXX)

- **Status:** Draft — pending review
- **Phase:** <N — Name>
- **Depends on:** <features, with status>
- **Blocks:** <features that consume this one>

## Problem
Why now, what is missing, what this unblocks. Two–five sentences.

## Goals
Concrete, derived from the PLAN line and user answers. Bullets, each verifiable.

## Non-goals
Mandatory. For each: what we are NOT doing and which future feature owns it.
This section is the scope fence — reviewers check against it first.

## User stories
Three personas, always the same:
1. Backend developer — what they run and see.
2. CI author — exit codes, machine-readable output, failure semantics.
3. AI agent — formats they consume (json/jsonl, docs), id stability.

## Contract / Model
CLI surface, data shapes, schemas — with exact field names. This is the section
future specs will cite when contracts evolve, so be precise.

## EARS acceptance criteria
`WHEN <trigger> THE SYSTEM SHALL <observable response>`.
- One observable behavior per criterion; no adverbs ("efficiently", "properly").
- Numbered AC-1..N; each must be mechanically checkable by a test.
- Cover: happy paths, every error path (with exit code), determinism/stability
  where relevant, and contract persistence (stdout-only reports, stderr errors).

## Testing strategy (TDD)
Unit (temp trees / pure functions), integration, e2e (spawn the built bin via
tests/e2e/helpers.ts runCli). Name the fixtures. State what needs no committed
fixture.

## Open questions for review
Every decision the user owns (see AGENTS.md): deps, contract changes, scope beyond
PLAN, constitution implications. Provide your recommendation for each — the user
approves or overrides. A spec with zero open questions is suspicious: re-check.
```

## design.md

Written **after** spec approval. Contents:

- **Module layout** — files to create/change, one line each on purpose.
- **Key decisions** — numbered, each with the alternative considered and why
  rejected. This is the section that saves the next agent from re-litigating.
- **Dependencies** — new deps with rationale and rejected alternatives.
- **Test map (AC → test)** — a table mapping every AC to its test. An AC without a
  row is a bug in the spec; fix the spec, not the map.

## tasks.md

- Task list in **TDD order**: config-only tasks first (marked "No TDD — pure
  config"), then RED→GREEN clusters ordered by dependency (things tests import
  come before things that import them), close-out last.
- Every task: `**T<n>. <title> (AC-refs).** RED: <tests>. GREEN: <modules>.`
- Final task is always close-out: check boxes, record deviations, update
  `docs/PLAN.md` status and spec status.

## Deviations discipline

Reality wins over the plan, loudly. When implementation reveals a bug, a tooling
quirk, or a spec mistake:

1. Record it in `tasks.md → Deviations & notes` (what happened, how handled).
2. If it invalidates an AC — stop and report to the user instead of silently
   redesigning.
3. Move durable knowledge (library behavior, tooling gotchas) into
   `docs/RESEARCH.md` so the next agent does not rediscover it.

Precedent: spec 002 T4 — jiti's virtual `default` made a default-less config look
valid; caught by a TDD test, fixed via own-property detection, documented twice.

## Quality bar (self-check before presenting a spec)

- [ ] Every AC maps to a test in the Test map.
- [ ] Non-goals name the owning future feature.
- [ ] Exit codes, stdout/stderr purity and determinism addressed where relevant.
- [ ] All user-owned decisions are open questions with recommendations.
- [ ] Code assumptions verified against `src/` today, not remembered.
