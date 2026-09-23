# Spec 024 — Agent skill installer (`backend-doctor install`) (F024)

- **Status:** Approved
- **Phase:** 4 — Integrations
- **Depends on:** F017 (Done — the `skills/backend-doctor/SKILL.md` artifact and
  its guard test); F023 (Done — the skill ships inside the npm package since
  0.1.1, pinned by the pack-contract test)
- **Blocks:** — nothing downstream; it is the user-facing front door for the
  F017 artifact

## Problem

The skill that teaches coding agents the backend-doctor protocol (when to
scan, how to read jsonl, how to act on findings) ships inside the npm package,
but getting it into an agent is manual: the README shows a hand-written
`cp` recipe for one agent family, and every user must know where their agent
looks for skills. The directories are an open convention — the Agent Skills
format (SKILL.md with YAML frontmatter) is read by Claude Code from
`.claude/skills/` (project) and `~/.claude/skills/` (personal), by Codex from
the `.codex/skills` equivalents, and Cursor and VS Code discover skills in
those same directories. The mechanics are mechanical, repeatable and easy to
get subtly wrong (wrong home, overwriting user edits blindly) — exactly what
a command should own. Spec 017 explicitly deferred this to its own PLAN line;
this is that line (F024).

## Goals

- **`backend-doctor install`**: copies the shipped skill folder
  (`skills/backend-doctor/` from the running package) into the conventions
  above, for a chosen agent and scope.
- **Two targets in v1:** `claude-code` (`.claude/skills/` project,
  `~/.claude/skills/` global) and `codex` (`.codex/skills/`,
  `~/.codex/skills/`). Two targets cover Claude Code, Codex, Cursor and
  VS Code, because the latter two discover skills in the same directories.
- **Detection by default:** `backend-doctor install` with no flags prints a
  status report (supported agents, source found?, per-target state:
  absent / up to date / differs) and writes nothing.
- **Idempotent updates:** identical content → no-op with exit 0; drifted
  content → refuse with exit 2 unless `--force` (the `ci install` / `init`
  precedent).
- **README alignment:** the "For coding agents" section makes
  `backend-doctor install` the primary path; the manual copy becomes the
  fallback.

## Non-goals

- **Uninstall / skill removal** — not requested; manual deletion is trivial.
  A future feature can own it.
- **Agent hooks** (react-doctor's opt-in post-edit wiring) — still a F017
  non-goal; the skill teaches the agent to run scans, it does not wire hooks.
- **AGENTS.md / CLAUDE.md generation** — those files carry project context,
  not skills; out of scope.
- **Targets without confirmed Agent Skills directories** (e.g. Gemini CLI) —
  added later as data, not code: the target table in `src/cli/commands/install.ts`
  is the extension point.
- **Interactive prompts** — the CLI stays non-interactive and scriptable
  (constitution §10); everything is flags.
- **New rules, severity changes, report schema, exit-code changes** — none.

## User stories

1. **Backend developer using Claude Code** — runs
   `npx backend-doctor-cli@latest install`, reads the report, runs
   `npx backend-doctor-cli@latest install --agent claude-code`, and their
   agent picks up the skill; after each backend-doctor release they re-run
   the same command and either get "up to date" or a loud drift notice.
2. **Team lead** — runs `install --agent claude-code --scope project` at the
   repo root; the skill lands in `.claude/skills/` and is committed, so every
   teammate's agent inherits the protocol with the checkout.
3. **AI agent** — discovers via its skill list the same SKILL.md that spec
   017 pins; the guard test keeps the taught commands truthful.

## Contract / Model

New top-level command (declared in `src/cli/run.ts`):

```
backend-doctor install [--agent <claude-code|codex>] [--scope <project|global>] [--force]
```

- **Skill source:** `<package root>/skills/backend-doctor/` resolved relative
  to the running module (`import.meta.url` from `dist/bin/`), so global
  installs, local installs and the npx cache all resolve identically. A
  missing source is a loud exit-2 error (constitution §8).
- **Target table** (the only agent-specific data, in
  `src/cli/commands/install.ts`):

  | agent id | project scope | global scope |
  |----------|---------------|--------------|
  | `claude-code` | `<cwd>/.claude/skills/backend-doctor/` | `<HOME>/.claude/skills/backend-doctor/` |
  | `codex` | `<cwd>/.codex/skills/backend-doctor/` | `<HOME>/.codex/skills/backend-doctor/` |

  HOME resolution uses `os.homedir()`; cwd is `process.cwd()`.
- **Copy semantics:** the whole skill folder is copied recursively
  (SKILL.md today; any future companion files travel automatically).
  Comparison is on the full folder contents: identical → no-op exit 0
  ("up to date"); different → exit 2 naming both paths and hinting
  `--force`; `--force` replaces the target folder with the source, exit 0.
- **Default (no flags):** detection report on stdout — source status plus one
  line per agent × scope with `absent | up to date | differs` — exit 0, no
  filesystem writes.
- **Exit codes (constitution §5, unchanged):** 0 success (including no-op and
  detection), 2 usage errors (unknown agent/scope, missing source, drift
  without `--force`) — exit 1 stays diagnostics-only and is never produced by
  `install`.
- **stdout/stderr:** normal output on stdout; usage errors and drift refusals
  on stderr; nothing is written to stdout on failure.
- `README.md` "For coding agents" section: `backend-doctor install` becomes
  the primary instruction; the manual `cp` recipe stays as the fallback.

## EARS acceptance criteria

- **AC-1** WHEN `install --agent claude-code` runs in a tree without
  `.claude/skills/` THE SYSTEM SHALL create
  `<cwd>/.claude/skills/backend-doctor/SKILL.md` byte-identical to the
  shipped skill, print the created path, and exit 0.
- **AC-2** WHEN the target already matches the source and install runs again
  THE SYSTEM SHALL exit 0 with an "up to date" message and leave the target
  bytes untouched.
- **AC-3** WHEN the target exists with different content and `--force` is
  absent THE SYSTEM SHALL exit 2, name both paths on stderr, write nothing
  to stdout, and leave the target untouched; WHEN `--force` is present THE
  SYSTEM SHALL replace the target with the source and exit 0.
- **AC-4** WHEN `install` runs with no flags THE SYSTEM SHALL print the
  detection report (source status; one `absent | up to date | differs` line
  per agent × scope) and exit 0 without creating or modifying any file.
- **AC-5** WHEN `--agent unknown-agent` is passed THE SYSTEM SHALL exit 2
  with the supported agent ids on stderr and nothing on stdout.
- **AC-6** WHEN `--scope global` is passed THE SYSTEM SHALL target the
  directory under `os.homedir()` (verified with an isolated HOME), not the
  working directory.
- **AC-7** WHEN the shipped skill folder is missing from the package THE
  SYSTEM SHALL exit 2 with a loud message naming the expected source path
  (unit level: the resolver returns a loud error for an absent source).
- **AC-8** WHEN the same command runs twice against the same filesystem
  state THE SYSTEM SHALL produce byte-identical stdout.

## Testing strategy (TDD)

- **Unit** (`tests/unit/cli/install-command.test.ts`): the command function
  takes injected roots (cwd, home, source dir) over temp trees — the
  `initCommand(cwd)` precedent. Covers AC-1..AC-8 at the function level:
  fresh install, no-op, drift refusal and `--force`, detection report
  (snapshot of stdout, no-write assertion via a tree fingerprint), unknown
  agent, global targeting with an injected home, missing source, output
  determinism.
- **E2E** (`tests/e2e/install-command.test.ts`): through the built bin via
  `runCli` with isolated `cwd` and `HOME` env (helpers accept `env`):
  happy path AC-1, no-op AC-2, drift + `--force` AC-3, detection AC-4,
  unknown agent AC-5, global scope AC-6. The shipped source is the real
  package tree — no new fixtures.
- **Guard continuity:** existing `tests/unit/skill.test.ts` and the pack pin
  stay green; README edits are covered by the live verification below.
- **Live verification (close-out):** every README command in the agents
  section executed verbatim; outputs recorded in `tasks.md`.

## Open questions for review

All four were resolved on approval (2026-09-23) by adopting the
recommendations: (1) default scope `project` (explicit `--scope` always
wins); (2) no-flag behavior is the detection report only — zero writes;
(3) targets v1 are `claude-code` + `codex`; (4) drift refuses with exit 2
unless `--force`.

1. **Default scope when `--agent` is given:** (a) `project` — writes into the
   current repo so the team shares it via VCS, mirrors `init`/`ci install`
   writing into cwd — recommended. (b) `global` — safer for the machine but
   invisible to teammates. (Explicit `--scope` always wins either way.)
2. **No-flag behavior:** (a) detection report only, no writes (recommended —
   observable, zero surprise, mirrors `--dump-config`). (b) auto-install
   `claude-code` + project when detected — faster but writes uninvited.
3. **Target set v1:** (a) `claude-code` + `codex` (recommended — covers
   Claude Code, Codex, Cursor, VS Code through their directory conventions,
   all confirmed against current docs). (b) `claude-code` only (smallest).
   (c) add more agents now (Gemini CLI etc. — directory conventions
   unconfirmed; deferred as data when confirmed).
4. **Drift refusal default:** (a) exit 2 + `--force` (recommended, the
   `ci install` precedent — the target may contain user edits). (b) silently
   overwrite on re-install (rejected: fails constitution §8's spirit).
