# Spec 017 — Agent integration: SKILL.md, rule-docs tooling, `rules` command, stable jsonl (F017)

- **Status:** Draft — pending review
- **Phase:** 4 — Integrations
- **Depends on:** F001 CLI skeleton (Done — `run.ts` command wiring, exit codes), F002
  Config (Done — rule ids validated against the registry), F003 Engine core +
  reporters (Done — `renderJsonl` exists), F004 Framework detection (Done —
  `frameworks` gates on rules), F013 Graph rules (Done — the second rule kind,
  project rules, is registered)
- **Blocks:** F023 npm publish & README (owns packaging the generated docs into the
  npm artifact and publishing, which is what activates the SKILL.md's
  `npx backend-doctor@latest` instructions)

## Problem

Phase 4 closes with the audience that consumes backend-doctor most literally: coding
agents. Today an agent has no written contract for *when* to run the tool, *which*
invocation to use, or *how* to read the output; `--format jsonl` exists since F001
but is pinned only incidentally by per-feature tests, not declared as a stable
surface; and the 41 rule docs in `docs/rules/backend-doctor/` are maintained by
hand with nothing enforcing that their headings, categories and severities keep
matching the registry — constitution §3 explicitly requires that "rule docs are
generated/validated by a script so docs cannot drift", and that script does not
exist yet. Finally, there is no way to discover the rule set from the CLI itself:
`rules` is a constitution-reserved command name (§10) with no implementation. This
spec delivers the four artifacts of the PLAN's F017 line: the agent skill file,
rule-docs generation/validation tooling, `rules list/explain`, and jsonl promoted
to a pinned, stable contract.

## Goals

- G1. New CLI command `backend-doctor rules list`: a deterministic, human-readable
  listing of every registered rule (file rules and project rules) with id,
  category, default severity and framework gate.
- G2. New CLI command `backend-doctor rules explain <id>`: full metadata for one
  rule — id, title, category, default severity, rule kind, framework gate, config
  key with allowed override values, and the declared doc path. Unknown id is a
  usage error (exit 2).
- G3. `skills/backend-doctor/SKILL.md` in this repository: the agent-facing skill
  (frontmatter `name`/`description`) teaching agents to run a changed-scope jsonl
  scan after backend edits, read the diagnostics, and consult rule docs by id.
  Content is static and hand-maintained; a test pins that its example commands
  reference only real CLI surface.
- G4. A rule-docs **drift gate** (constitution §3): a validated check that every
  registered rule has a doc at its declared `docs` path whose heading, `Category`
  and `Default severity` lines match the registry, with no orphan docs — enforced
  by the test suite, so the existing CI (`pnpm test`) fails on drift.
- G5. A rule-docs **scaffold** (the "generation" half of the PLAN line): a
  maintainer-run script that writes a skeleton doc for a registered rule from
  registry metadata (correct heading/category/severity, TODO prose placeholders)
  and refuses to overwrite an existing doc.
- G6. `--format jsonl` is promoted to a pinned stable contract: dedicated tests
  fix the line discipline (one JSON object per diagnostic, exact key set and
  order, nothing else on stdout, empty output for an empty report,
  byte-identical double runs). The reporter implementation itself is unchanged.
- G7. No new dependencies, no new npm packages, no config or report-schema
  changes; the shipped CLI grows exactly one top-level command (`rules`, already
  reserved by constitution §10).

## Non-goals

- **Agent installer** (`npx backend-doctor install` detecting Claude Code/Cursor/
  Codex and copying the skill into their config dirs, react-doctor parity) — the
  PLAN line ships the SKILL.md artifact, not an installer; an installer would need
  a new PLAN line.
- **Native agent hooks** (react-doctor's opt-in `--agent-hooks` post-edit
  integration) — a runtime/watch integration, not in the F017 line.
- **Machine formats for the `rules` command** (`rules list --json` etc.) — agents
  consume scan jsonl and the rule docs; a JSON listing is additive later
  (constitution §5) if wanted.
- **`rules explain --doc` / printing doc bodies from the CLI, packaging rule docs
  into the npm tarball, canonical docs URLs** — F023 owns packaging and publish
  surfaces; today `explain` prints the doc *path* only.
- **Rules activity view** (`rules list --active` reflecting framework detection in
  the current project) — would couple the command to a scan; the gate column
  already shows when a rule applies.
- **New rules, severity changes, config fields, report schema or `schemaVersion`
  changes** — none of these are touched.
- **Runtime probes** — Phase 5 (F018–F021).

## User stories

1. **Backend developer** — before wiring backend-doctor into her workflow she runs
   `backend-doctor rules list` to see what the tool checks and
   `backend-doctor rules explain backend-doctor/no-prisma-n-plus-one` to read one
   rule's severity, when it activates (framework gate) and where its full
   documentation lives.
2. **CI author** — nothing changes for her pipelines: the drift gate rides the
   existing `pnpm test` step of this repository's CI, adds no new workflow, and
   the new commands are irrelevant to user CI. If she maintains a fork or a rule
   pack, `pnpm build && node dist/scripts/rule-docs.js --check` gives the same
   gate locally, exit 1 on violations.
3. **AI agent** — following `skills/backend-doctor/SKILL.md`, after editing
   backend code it runs `npx backend-doctor@latest scan --scope changed
   --format jsonl`, reads zero or more one-line JSON diagnostics with stable field
   names and deterministic ids, fixes them, and looks up any rule id in
   `docs/rules/backend-doctor/<rule>.md` (or `rules explain <id>`) for bad/good
   examples. Nothing in the format it parses can drift silently: jsonl is pinned
   by contract tests, and the docs cannot drift from the registry.

## Contract / Model

Parts marked **[OQ-n]** are gated on the open questions; the text below states
the recommended shape.

### CLI surface (additive; `scan`/`init`/`ci` untouched)

```
backend-doctor rules list
  Print every registered rule (both kinds) in registry registration order:
  a header line, one line per rule (id, category, default severity, framework
  gate — "-" when unconditional), a blank line, a final "<N> rules" line.
  Exit 0. stdout only.

backend-doctor rules explain <rule-id>
  Print one rule's metadata: id, title, category, default severity, rule kind
  (file rule | project rule), framework gate (named frameworks or "none —
  runs unconditionally"), the config key with its three override values
  (off | warn | error), and the declared doc path.
  The id must be the full registered id ("backend-doctor/no-eval"); no bare
  alias ("no-eval") is accepted.
  Exit 0 on success; exit 2 (stderr only) for an unregistered id or a missing
  argument.
```

The command takes no flags in this feature. `rules` never loads config, never
scans, and performs no filesystem or network I/O beyond module load — it is a
pure view of the registry (constitution §1, §10).

Illustrative output (exact spacing is a design.md concern; the tests pin the
content and determinism, not the whitespace):

```
$ backend-doctor rules list
RULE ID                                CATEGORY          SEVERITY  GATE
backend-doctor/no-eval                 Security          warn      -
backend-doctor/no-prisma-n-plus-one    Performance       warn      prisma
…

41 rules

$ backend-doctor rules explain backend-doctor/no-eval
backend-doctor/no-eval
  Title: No eval
  Category: Security
  Default severity: warn
  Kind: file rule (runs once per analyzed file)
  Framework gate: none — runs unconditionally
  Config key: rules["backend-doctor/no-eval"] — off | warn | error
  Docs: docs/rules/backend-doctor/no-eval.md
```

### SKILL.md (`skills/backend-doctor/SKILL.md`)

Static markdown with a YAML front matter and instructional body. Shape:

```markdown
---
name: backend-doctor
description: <one sentence — static analysis for Node.js/NestJS backends; use
  after editing backend code to catch async, security, performance and
  architecture issues>
---

# backend-doctor

## When to run
after editing backend TypeScript (routes, services, repositories, config)…

## How to run
npx backend-doctor@latest scan --scope changed --format jsonl   # after edits
npx backend-doctor@latest scan --format jsonl                   # full audit

## Reading findings
one JSON object per line; fields id/filePath/line/column/rule/category/
severity/message/tags; empty output means clean; exit 0 clean, 1 findings at
error severity, 2 usage error.

## Acting on findings
fix the code; `rules explain <id>`; docs/rules/backend-doctor/<rule>.md …
```

[OQ-3] fixes the primary recommended invocation. The file teaches the
`npx backend-doctor@latest` form (react-doctor precedent); it becomes fully
functional at F023 when the package is published — this spec ships the artifact
and its guard test, not the npm package.

### Rule-docs tooling (repo-internal; not part of the shipped CLI surface)

Shared core in `src/rule-docs/` (pure, unit-testable), a thin runner built as a
second tsup entry [OQ-2], and a test-based CI gate:

- **Check** — `checkRuleDocs(rules, docsRoot)` returns per-violation findings;
  a violation is: no doc at the rule's declared `docs` path; doc heading ≠ rule
  id; `Category:` line ≠ rule category; `Default severity:` line ≠ rule
  severity; or a markdown file directly under `<docsRoot>/backend-doctor/` that
  no registered rule declares. Enforced by a unit test over the *real* registry
  and the real `docs/rules/` tree (green today — verified: all 41 docs exist and
  their metadata matches the registry), so drift fails `pnpm test` in existing
  CI. The runner exposes the same check as `--check` (exit 0 clean / 1
  violations / 2 usage — maintainer tooling, not part of the user-facing CLI
  contract).
- **Scaffold** — `scaffoldRuleDoc(rule, docsRoot)` writes a skeleton doc at the
  declared path when it does not exist: correct `# <id>` heading, `Category:`
  and `Default severity:` lines from the registry, placeholder sections
  (`## Problem`, `## Bad`, `## Good`, `## Configuration`) with explicit TODO
  markers. Refuses to overwrite (exit 2, file untouched). Runner:
  `node dist/scripts/rule-docs.js --scaffold <rule-id>`.

The runner is maintainer tooling: it lives in the repo, is built by the standard
`pnpm build`, and is never advertised in `--help`. Whether it ships inside the
published npm tarball is F023's packaging decision.

### jsonl stability contract (no code change; pinned by tests)

`scan --format jsonl` (existing `renderJsonl`) is hereby a stable surface
(constitution §5): exactly one line per diagnostic in report order; each line is
a JSON object with exactly the `Diagnostic` keys in declaration order — `id`,
`filePath`, `line`, `column`, `rule`, `category`, `severity`, `message`, `tags`;
nothing else on stdout; zero diagnostics render as zero bytes. Breaking these
properties requires a `schemaVersion`-style announcement per constitution §5.
The SKILL.md teaches this exact shape.

### Constitution notes

- §1 (deterministic): `rules` output derives only from registry order (a static,
  hand-curated array — byte-identical across runs); jsonl and doc tooling are
  pure functions; SKILL.md is a static file.
- §3 (every rule ships with tests and docs): the drift gate is the
  constitution-mandated validation mechanism, delivered at last.
- §5 (stable contracts): additive CLI growth; `scan` flags, config fields,
  report schema and exit codes untouched; jsonl explicitly pinned.
- §10 (small, boring surface): one new top-level command, the
  constitution-reserved `rules`, two subcommands, zero flags.

## EARS acceptance criteria

**`rules list`**

- **AC-1.** WHEN `rules list` runs THE SYSTEM SHALL print to stdout a header
  line, exactly one line per registered rule (file rules and project rules —
  41 at the time of writing) in registry registration order, each line carrying
  the rule id, its category, its default severity and its framework gate
  (`-` when the rule has no `frameworks` restriction), followed by a final
  `<N> rules` count line; THE SYSTEM SHALL exit `0` and write nothing to stderr.
- **AC-2.** WHEN `rules list` runs twice THE SYSTEM SHALL produce byte-identical
  stdout.

**`rules explain`**

- **AC-3.** WHEN `rules explain` runs with a registered rule id THE SYSTEM SHALL
  print to stdout the rule's id, title, category, default severity, rule kind
  (file rule | project rule), framework gate (the framework ids, or an explicit
  "runs unconditionally" form), the config key with the allowed override values,
  and the declared doc path; THE SYSTEM SHALL exit `0` and write nothing to
  stderr.
- **AC-4.** WHEN the id argument is not a registered rule id THE SYSTEM SHALL
  exit `2`, name the offending id on stderr, and write nothing to stdout.
- **AC-5.** WHEN `rules explain` runs with no id argument THE SYSTEM SHALL exit
  `2` with usage information on stderr and nothing on stdout.

**SKILL.md**

- **AC-6.** WHEN `skills/backend-doctor/SKILL.md` is read THE SYSTEM SHALL
  contain a YAML front matter with `name: backend-doctor` and a non-empty
  `description`, and every `backend-doctor …` invocation it shows SHALL use
  shipped commands and flags (verified against a fixed allowlist of the real
  CLI surface in the guard test), with documented exit codes 0/1/2 matching the
  scan semantics.

**jsonl stability**

- **AC-7.** WHEN a report renders as jsonl THE SYSTEM SHALL emit exactly one
  line per diagnostic in report order, each line parsing as a JSON object whose
  keys are exactly the Diagnostic fields in declaration order (`id`, `filePath`,
  `line`, `column`, `rule`, `category`, `severity`, `message`, `tags`); WHEN the
  report has zero diagnostics THE SYSTEM SHALL emit zero bytes on stdout; and
  two renders of the same report SHALL be byte-identical.

**Rule-docs drift gate**

- **AC-8.** WHEN the docs check runs over the real registry and `docs/rules/`
  (as part of `pnpm test`) THE SYSTEM SHALL pass iff every registered rule has a
  markdown doc at its declared `docs` path whose first heading equals the rule
  id, whose `Category:` line equals the rule category and whose
  `Default severity:` line equals the rule severity, and iff every markdown file
  under `docs/rules/backend-doctor/` is declared by some registered rule; on any
  violation THE SYSTEM SHALL fail naming each offending file and the mismatched
  field.

**Scaffold**

- **AC-9.** WHEN the scaffold runner is invoked with a registered rule id whose
  doc does not exist THE SYSTEM SHALL create the doc at the declared path with
  the correct heading, `Category:` and `Default severity:` lines from the
  registry and explicit TODO placeholders for the prose sections, and exit `0`;
  WHEN the doc already exists THE SYSTEM SHALL exit `2`, leave the file
  byte-identical, and say so on stderr; WHEN the id is unregistered THE SYSTEM
  SHALL exit `2` naming it.

## Testing strategy (TDD)

- **Unit — formatters (`tests/unit/cli/rules.test.ts`)**
  - `formatRulesList(allRules(), allProjectRules())`: line count = rules + 2
    (header + summary), registration order preserved, gate `-` vs framework
    ids, summary count; double-call byte-equality (AC-1, AC-2 at unit level).
  - `formatRuleExplain(rule)`: contains id, title, category, severity, kind,
    gate form for both a gated and an unconditional rule, config key, doc path
    (AC-3).
- **e2e — `tests/e2e/rules-command.test.ts`** (built bin via `runCli`):
  - AC-1/AC-2: run `rules list`, assert stdout shape and double-run
    byte-equality, empty stderr, exit 0.
  - AC-3: `rules explain backend-doctor/no-eval` (unconditional) and a prisma-
    gated id — stdout content, exit 0, empty stderr.
  - AC-4: `rules explain backend-doctor/does-not-exist` — exit 2, id on stderr,
    empty stdout.
  - AC-5: `rules explain` without argument — exit 2, empty stdout.
- **Unit — SKILL guard (`tests/unit/skill.test.ts`)**: read
  `skills/backend-doctor/SKILL.md`; assert front matter (`name: backend-doctor`,
  non-empty description); extract every `backend-doctor …` invocation and assert
  command/subcommand/flags against an explicit allowlist mirroring `run.ts`
  (AC-6). No fixtures.
- **Unit — jsonl contract (`tests/unit/jsonl-contract.test.ts`)**: a hand-built
  report with ≥2 diagnostics of varied severities/tags — one line per
  diagnostic, `Object.keys` of each parsed line exactly the 9 Diagnostic fields
  in declaration order, empty report → `""`, double-render byte-equality (AC-7).
  Complements the existing per-feature "jsonl stays diagnostics-only" e2e tests,
  which keep passing unchanged.
- **Unit — rule-docs check (`tests/unit/rule-docs.test.ts`)**:
  - Real-tree gate: `checkRuleDocs([...allRules(), ...allProjectRules()],
    "docs/rules")` passes (AC-8 green path; this test IS the CI gate).
  - Injected-list red paths in a temp `docsRoot`: missing doc, wrong heading,
    wrong category, wrong severity, orphan file — each violation named with file
    and field (AC-8 red paths).
- **Unit + runner — scaffold**: `scaffoldRuleDoc` into a temp `docsRoot`:
  content has the registry heading/category/severity and TODO markers; second
  call does not overwrite; unregistered id rejected (AC-9 core). Runner e2e via
  `node dist/scripts/rule-docs.js` (second tsup entry, built by the vitest
  globalSetup build): `--scaffold` in a temp dir — exit 0 then exit 2 with file
  untouched; `--check` exit codes on a seeded temp tree (AC-9 runner paths).
- No `tests/fixtures/` additions; all temp trees via `makeTmpDir()`. Existing
  suites stay green unchanged.

## Open questions for review

1. **Scope split of "rule docs generation" between F017 and F023.** Both PLAN
   lines mention docs tooling: F017 says "markdown rule docs generation
   (`docs/rules/{id}.md`)", F023 says "rule docs generation script". (a) F017
   delivers the drift gate (constitution §3's "validated by a script") plus the
   scaffold (the "generation" half) as repo tooling, and F023 keeps only the
   packaging/publish concerns (docs in the npm tarball, README links, canonical
   URLs) — recommended: it makes F017 self-contained, the gate lands now while
   41 docs are fresh, and nothing in F023 is duplicated. (b) F017 ships only
   `rules list/explain` + SKILL.md + jsonl pinning; all docs tooling moves to
   F023 — but that leaves the F017 PLAN line's "rule docs generation" undelivered
   this feature. **Recommendation: (a).**
2. **Scaffold/check runner mechanism.** The tooling core is pure TS in `src/`;
   something must run it outside vitest. (a) Second tsup entry
   (`dist/scripts/rule-docs.js`), invoked as
   `pnpm build && node dist/scripts/rule-docs.js --check|--scaffold <id>` —
   recommended: zero new dependencies, reuses the existing build that every test
   run already performs, works under our `.js`-extension import convention;
   touches the build config (a new build artifact), which is why it is asked.
   (b) `node --experimental-strip-types scripts/rule-docs.ts` — rejected: plain
   Node does not resolve our `.js`→`.ts` import spellings, so the script would
   need its own import style. (c) New dev dependency (`tsx`) — rejected: adds a
   dependency for a maintainer-only convenience (user-owned decision per
   AGENTS.md, hence this question). **Recommendation: (a).**
3. **The primary invocation the SKILL.md teaches.** (a)
   `npx backend-doctor@latest scan --scope changed --format jsonl` after edits
   (react-doctor precedent: "run after edits, scope changed"), full scan for
   repo-wide audits — recommended: cheapest useful signal for an agent, and
   jsonl is the format this spec pins. (b) Always a full scan — slower on large
   repos and noisier (pre-existing issues drown the agent's own edits);
   `--scope changed` exists precisely for the post-edit flow (F015). Note for
   either choice: the `@latest` form activates at F023 publish; until then the
   skill is forward-looking documentation, and repo-local runs use the built
   bin. **Recommendation: (a).**
