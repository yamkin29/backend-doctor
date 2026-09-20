# Design 017 — Agent integration (F017)

Spec: `spec.md` (Approved 2026-09-20). All open questions resolved by adopting
the recommendations.

## Module layout

| File | Purpose |
|---|---|
| `src/cli/commands/rules.ts` | `rulesListCommand()` / `rulesExplainCommand(id)` + pure formatters `formatRulesList()` / `formatRuleExplain()` (exported for unit tests). |
| `src/cli/run.ts` | Register the `rules` command group with `list` / `explain` subcommands (same pattern as `ci`). |
| `src/rule-docs/index.ts` | Rule-docs tooling core: `resolveDocPath()`, `checkRuleDocs()`, `scaffoldRuleDocContent()`, `scaffoldRuleDoc()`; `RuleDocsMeta` structural type. |
| `src/scripts/rule-docs.ts` | Maintainer runner: `--check` / `--scaffold <id>`; exit 0/1/2. Built by a second tsup entry. |
| `tsup.config.ts` | New entry `"scripts/rule-docs": "src/scripts/rule-docs.ts"` → `dist/scripts/rule-docs.js`. |
| `skills/backend-doctor/SKILL.md` | The agent skill artifact (frontmatter + when/how/read/act/exit-codes). |
| `tests/unit/jsonl-contract.test.ts` | AC-7 jsonl pin. |
| `tests/unit/cli/rules-command.test.ts` | AC-1/AC-2/AC-3 formatter units. |
| `tests/e2e/rules-command.test.ts` | AC-1..AC-5 end-to-end via the built bin. |
| `tests/unit/rule-docs.test.ts` | AC-8 real-tree gate + red paths; AC-9 scaffold units; AC-9 runner spawn tests. |
| `tests/unit/skill.test.ts` | AC-6 SKILL.md guard. |

## Key decisions

1. **Formatters live beside the command** (`src/cli/commands/rules.ts`), pure
   and exported. Alternative: `src/reporters/` — rejected: they render registry
   metadata, not a `ReportDocument`; `reporters/` is the scan-output contract
   surface.
2. **List order = registration order**, file rules then project rules (the
   order of `productRules` / `productProjectRules` in `src/rules/index.ts`).
   Alternative: alphabetical — rejected: registration order is the curated
   pack-by-pack product order; both are deterministic, this one is also
   meaningful. Verified: `rules/index.ts` is a static hand-curated array, so
   the output is byte-stable across runs and machines (AC-2).
3. **`rules explain` matches full ids only** (`backend-doctor/no-eval`), no
   bare alias. Alternative: accept `no-eval` — rejected: one lookup rule,
   zero ambiguity if a second plugin ever lands; adding an alias later is
   additive (constitution §5). Unknown id → exit 2 with the id on stderr plus
   a pointer to `rules list`.
4. **The `rules` command is a pure registry view**: no config load, no
   filesystem access, no scan. This keeps it deterministic and instant, and
   matches the PLAN line (discovery, not project analysis). An `--active`
   detection-coupled view stays a non-goal.
5. **`checkRuleDocs(rules, docsDir)` returns `string[]` violations** (each
   starts with the offending file path), empty = clean. Alternative: structured
   `{ file, field, expected, actual }[]` — rejected as premature; the runner
   prints lines, the tests assert substrings; a structured shape can be added
   additively without breaking the call sites.
6. **Doc path resolution: `resolveDocPath(rule, docsDir)` =
   `join(docsDir, relative("docs/rules", rule.docs))`** with a `path` violation
   when `rule.docs` does not start under the canonical `docs/rules/` root.
   This is what makes temp-tree testing natural: tests craft rules whose
   `docs` field still spells `docs/rules/…` but resolve under a temp `docsDir`
   — no env globals, no cwd games. The canonical root constant lives beside
   the resolver.
7. **Scaffold refuses overwrite via `fs.writeFileSync(…, { flag: "wx" })`**
   after `mkdirSync(dirname, { recursive: true })` — atomic create-or-fail, no
   exists-then-write race. `scaffoldRuleDocContent(rule)` is the pure
   content builder (heading, Category, Default severity from the registry;
   explicit `TODO:` markers in Problem/Bad/Good; a working Configuration
   snippet); a scaffolded doc passes `checkRuleDocs` immediately because the
   check only validates registry-derived metadata, while the TODO prose stays
   loudly unfinished.
8. **Runner parses `process.argv` by hand** (`--check`, `--scaffold <id>`).
   Alternative: commander — rejected: a 20-line maintainer script does not
   need it, and keeping it dependency-free emphasizes that it is not part of
   the user CLI contract. Its exit codes (0 clean / 1 violations / 2 usage or
   unknown id) are maintainer-tool semantics, documented here and in
   `--help`-style usage line, not constitution §5 CLI contract.
9. **SKILL guard = explicit allowlist** mirroring `run.ts` (commands,
   subcommands, flags per command), hand-updated when the CLI grows.
   Alternative: derive the allowlist by parsing `run.ts` — rejected: clever,
   brittle, and the constitution puts cleverness in the engine, not tooling.
   The test extracts invocation lines from fenced code blocks and checks
   command/subcommand/flags against the allowlist.
10. **jsonl needs no code change** — verified before design: the runner builds
    every Diagnostic object literal in interface declaration order (`id`,
    `filePath`, `line`, `column`, `rule`, `category`, `severity`, `message`,
    `tags`; `src/engine/runner.ts`), `renderJsonl` is already one-JSON-object-
    per-line and empty-report-safe. The deliverable is the pinning test
    (AC-7); green-on-arrival tests are recorded as characterization in
    `tasks.md`.
11. **Second tsup entry for the runner** (approved OQ-2): tsup resolves our
    `.js`→`.ts` import spellings when bundling, so the script reuses all src
    modules unchanged; `globalSetup` runs the same `buildOptions`, so
    `dist/scripts/rule-docs.js` exists in every test run with no extra build
    step. Whether `dist/scripts/` ships in the npm tarball is F023's decision.

## Dependencies

None new. `--scaffold`/`--check` use `node:fs`/`node:path`; the runner reuses
the in-repo registry. No package.json changes (invocation documented as
`pnpm build && node dist/scripts/rule-docs.js …`).

## Test map (AC → test)

| AC | Test |
|---|---|
| AC-1 (`rules list` shape/order/count/exit) | `tests/unit/cli/rules-command.test.ts` (formatter: header, one line per rule in registration order, gate `-` vs frameworks, `<N> rules` summary) + `tests/e2e/rules-command.test.ts` ("lists every registered rule": line count, known ids incl. gated + project rules, exit 0, empty stderr) |
| AC-2 (byte-identical `rules list`) | unit double-call byte-equality + e2e double-run byte-equality |
| AC-3 (`rules explain` success) | unit `formatRuleExplain` (unconditional file rule, prisma-gated file rule, project rule: kind/gate/config key/doc path) + e2e for the same three ids |
| AC-4 (unknown id → 2) | e2e `rules explain backend-doctor/does-not-exist` → exit 2, id on stderr, empty stdout |
| AC-5 (missing arg → 2) | e2e `rules explain` without argument → exit 2, empty stdout |
| AC-6 (SKILL.md guard) | `tests/unit/skill.test.ts`: frontmatter name/description; every invocation's command/subcommand/flags against the allowlist; exit-codes section present |
| AC-7 (jsonl contract) | `tests/unit/jsonl-contract.test.ts`: one line per diagnostic in report order; `Object.keys` per line exactly the 9 Diagnostic fields in declaration order; empty report → `""`; double-render byte-equality |
| AC-8 (drift gate) | `tests/unit/rule-docs.test.ts`: real-tree `checkRuleDocs([...allRules(), ...allProjectRules()], "docs/rules")` passes (this test IS the CI gate); temp-tree red paths — missing doc, wrong heading, wrong category, wrong severity, non-canonical `docs` path, orphan file — each violation named |
| AC-9 (scaffold + runner) | unit: `scaffoldRuleDocContent` metadata/TODO markers, `scaffoldRuleDoc` create-then-refuse in temp dir; runner spawns of `dist/scripts/rule-docs.js` in a seeded temp cwd: `--scaffold` 0 then 2 (file byte-identical), `--scaffold` unknown id → 2, `--check` 0 on a valid seeded tree and 1 naming an orphan |

Fixtures: none needed (temp trees via `makeTmpDir()`); existing suites stay
untouched and green.
