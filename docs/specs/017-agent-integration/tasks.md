# Tasks 017 — Agent integration (F017)

TDD order: pinning tests and pure modules that tests import come first; the
runner (which depends on the rule-docs core) and the skill artifact come last.
Every task: red → green → refactor, commit per green task.

- [ ] **T1. Pin the jsonl output contract (AC-7).** RED:
      `tests/unit/jsonl-contract.test.ts` — one line per diagnostic in report
      order, `Object.keys` of each parsed line exactly the 9 Diagnostic fields
      in declaration order, empty report → `""`, double-render byte-equality.
      GREEN: expected to pass against the existing implementation
      (characterization — the runner already builds Diagnostic literals in
      interface order, `renderJsonl` is already diagnostics-only; design
      decision 10). If any assertion fails, that is a real contract break to
      fix minimally in `src/reporters/jsonl.ts` / `src/engine/runner.ts`.
- [ ] **T2. `rules list` / `rules explain` formatters and commands (AC-1..AC-3
      unit level).** RED: `tests/unit/cli/rules-command.test.ts` importing
      `src/cli/commands/rules.js` (module missing). GREEN:
      `src/cli/commands/rules.ts` — pure `formatRulesList(fileRules,
      projectRules)` and `formatRuleExplain(rule, kind)`, plus
      `rulesListCommand()` / `rulesExplainCommand(id)` writing to
      stdout/stderr and returning exit codes (registry imported for side
      effect, `scan.ts` precedent). Not yet wired into `run.ts`.
- [ ] **T3. Register the `rules` command + e2e (AC-1..AC-5).** RED:
      `tests/e2e/rules-command.test.ts` spawning the built bin — `rules list`
      shape/determinism, `rules explain` for an unconditional, a prisma-gated
      and a project rule, unknown id → 2, missing arg → 2. GREEN: `run.ts`
      grows the `rules` group with `list` / `explain` subcommands (same
      pattern as `ci`).
- [ ] **T4. Rule-docs drift check (AC-8).** RED:
      `tests/unit/rule-docs.test.ts` importing `src/rule-docs/index.js`
      (module missing): real-tree gate over
      `[...allRules(), ...allProjectRules()]` vs `docs/rules`; temp-tree red
      paths (missing doc, wrong heading, wrong category, wrong severity,
      non-canonical `docs` path, orphan file). GREEN: `src/rule-docs/index.ts`
      — `RuleDocsMeta`, `resolveDocPath()`, `checkRuleDocs()`. From this task
      on, `pnpm test` enforces constitution §3 for every future rule.
- [ ] **T5. Doc scaffolding (AC-9 core).** RED: unit tests for
      `scaffoldRuleDocContent()` (registry metadata, TODO markers, working
      config snippet) and `scaffoldRuleDoc()` (create in temp dir; second call
      refuses and leaves the file byte-identical). GREEN:
      `scaffoldRuleDocContent()` + `scaffoldRuleDoc()` in
      `src/rule-docs/index.ts` using `writeFileSync(…, { flag: "wx" })` after
      recursive mkdir.
- [ ] **T6. Runner + second tsup entry (AC-9 runner paths).** RED: spawn tests
      of `dist/scripts/rule-docs.js` in a seeded temp cwd (`--scaffold`
      created→exists, unknown id, `--check` clean/violation); the file does
      not exist yet. GREEN: `src/scripts/rule-docs.ts` (hand-rolled argv
      parsing, exit 0/1/2) + tsup entry `"scripts/rule-docs"` — the vitest
      `globalSetup` build produces it automatically.
- [ ] **T7. SKILL.md + guard test (AC-6).** RED: `tests/unit/skill.test.ts`
      reading `skills/backend-doctor/SKILL.md` (file missing). GREEN: write
      `skills/backend-doctor/SKILL.md` — frontmatter `name: backend-doctor` +
      description, when-to-run / how-to-run (`scan --scope changed --format
      jsonl`, full-scan audit) / reading findings (jsonl fields, exit codes
      0/1/2) / acting on findings (fix first, config silencing, `rules
      explain`, rule docs path). Guard asserts the frontmatter and validates
      every invocation against an explicit command/subcommand/flag allowlist
      mirroring `run.ts`.
- [ ] **T8. Close-out.** Check off tasks, record deviations, spec status →
      `Implemented`, `docs/PLAN.md` F017 → `Done`, live CLI smoke test
      (`rules list`, `rules explain`, `scan --format jsonl`, runner
      `--check`) with eyeballed output.

## Deviations & notes

- T1 recorded as **characterization**: the jsonl contract test passed against
  the existing implementation without any code change (expected — design
  decision 10; the pin is the deliverable, per the approved spec's "no code
  change" goal G6).
- (further deviations recorded as they happen)
