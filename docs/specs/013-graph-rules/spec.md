# Spec 013 — Graph rules: cycles & unused (F013)

- **Status:** Implemented (2026-09-20)
- **Phase:** 3 — Project-level (opt-in, full scan)
- **Depends on:** F003 (engine core: adapter, registry, runner, report) —
  Done; F004 (framework detection, package-root reading precedent) — Done;
  F002 (config severity/ignore matrix) — Done; F012 (pack/fixture/doc
  patterns) — Done
- **Blocks:** F015 (diff scope must carry graph diagnostics unchanged),
  F017 (rule docs + jsonl consume this pack), F022 (eval corpus gates the
  precision of the unused-* rules)

## Resolution (recorded at approval, 2026-09-20)

The user approved the spec as recommended ("принято"). All open questions
resolved as recommended: (1) all four rules ship enabled at `warn` — no
default-off severity; (2) one diagnostic per file participating in a cycle,
canonical chain in each message; (3) entry heuristic is `package.json`
`main`/`bin` + `src/main.ts`/`src/index.ts`/`main.ts`/`index.ts`, and the
reachability rules stay silent when no entry exists; (4) `unused-dependency`
covers `dependencies` only (minus `@types/*` and non-registry protocols),
with `scripts` mentions counting as usage; (5) no new dependencies.

Implementation note (recorded at close-out, 2026-09-20): AC-3 additionally
stays silent when the project has **no entry files** — without a known
public-surface boundary every import-less export would be flagged, which
is the same precision gate AC-2 already establishes. All AC-3 cases with
entries present behave exactly as specified.

## Problem

Every shipped rule inspects one file at a time, so the four defects of the
PLAN line are invisible: circular import chains (init-order surprises, test
mocks that stop working, blocks tree-shaking), files nothing can reach from
any entry point (dead code that still gets compiled, type-checked and
maintained), exported symbols nothing imports (API surface that drifted),
and declared `dependencies` nothing references (install weight, audit
surface, misleading package.json). All four are properties of the *import
graph*, not of a single file — the adapter already exposes everything the
graph needs (`getModuleSpecifiers()` per analyzed file), and RESEARCH
reserves this exact feature for a second rule kind (the react-doctor
`create`/`scan(file)` split). What is missing is the project-level pass in
the engine, the import-graph machinery, and the four rules on top.

## Goals

- A second rule kind in the engine, per the RESEARCH precedent: alongside
  per-file `RuleDefinition`, a **project rule** that runs once per scan
  over all analyzed files and reports findings against any file (or the
  package root for `unused-dependency`). Same lifecycle as file rules:
  registration in the product registry, pack gate (`frameworks`), config
  severity/ignore matrix, and fail-soft isolation (a crashing project rule
  becomes an `internal` diagnostic plus a `skippedChecks` entry, never a
  failed scan — constitution §8). Engine module boundary untouched: the
  graph is built from `SourceFileView.getModuleSpecifiers()` plus plain
  path math (constitution §4; no ts-morph graph APIs).
- A deterministic import-graph module in the engine: resolves each file's
  relative specifiers (`./`, `../`) to analyzed files — trying the literal
  specifier, the TypeScript ESM mappings (`.js`→`.ts`, `.mjs`→`.mts`,
  `.cjs`→`.cts`) and `/index` variants — bare specifiers are package
  imports, unresolvable specifiers produce no edge. Entries, reachability
  and cycles are derived from the same adjacency.
- Four new rules, all default `warn` (constitution §2), framework-free
  (no `frameworks` gate), in a new `src/rules/graph/` module:
  - `backend-doctor/circular-dependency` (Architecture) — one diagnostic
    per file that participates in an import cycle, positioned at the
    file's first import statement that participates in the cycle (fallback
    line 1), with the full cycle chain named in the message (the cycle is
    rotated so the lexicographically smallest member comes first —
    deterministic).
  - `backend-doctor/unused-file` (Maintainability) — one diagnostic per
    analyzed file that is not reachable from any entry file through import
    edges. Entry files: package.json `main`/`bin` targets, plus
    `src/main.ts`, `src/index.ts`, `main.ts`, `index.ts` under the package
    root (existing files only). When no entry file exists, the rule stays
    silent — it cannot prove anything.
  - `backend-doctor/unused-export` (Maintainability) — one diagnostic per
    exported symbol (named exports and `export default`) that no *other*
    analyzed file imports. Usage: a named import uses that name; a default
    import uses `default`; a namespace import, side-effect import,
    `require`, dynamic `import()`, or a re-export (`export … from`) uses
    *all* exports of the target file. Entry files are exempt (their
    exports are the public surface); files the rule runs on are exempt
    from their own self-imports.
  - `backend-doctor/unused-dependency` (Maintainability) — one diagnostic
    per `package.json` `dependencies` entry that no analyzed module
    specifier references (package name exact or subpath prefix) and that
    no `scripts` string mentions. `devDependencies` are out (binaries and
    tooling live there); `@types/*` and non-registry protocols
    (`workspace:`, `file:`, `link:`, …) are excluded. The diagnostic is
    reported against the package root's `package.json`.
- No report, CLI, config-field, or exit-code changes: the diagnostic and
  report shapes stay as they are (`schemaVersion` 1), the four rule ids are
  the only new surface, `src/index.ts` public exports are untouched. No new
  dependencies (cycle detection and reachability are hand-rolled DFS —
  the boring option).
- Determinism (constitution §1): the graph derives from the sorted file
  list and per-file specifiers; cycles, reachability and usage sets are
  computed with stable iteration order and sorted outputs; two scans are
  byte-identical.

## Non-goals

- Type-aware "usage" (the TS checker): re-export chains that rename
  symbols, string-based DI tokens, or usages through computed access stay
  approximate — the engine stays syntax-only (spec 003). The eval corpus
  (F022) is the precision gate; a rule that cries wolf there gets fixed or
  demoted before anything else ships.
- Monorepo/workspace graphs: one package root per scan is the existing
  model (`findPackageRoot`); multi-project graphs are future work.
- Dynamic specifier shapes (`import(\`./x/${name}\`)`, computed require):
  only literal specifiers form edges (the adapter's existing contract).
  Documented recall hole, not an FP risk.
- Graph *queries* beyond the four rules (orphan detection by coupling
  metrics, layer enforcement, module boundaries): PLAN F013 is the four
  names above; deeper architecture rules are not scoped.
- Nest DI cycles: `backend-doctor/circular-di` (F009) already owns the
  constructor/DI graph; this feature adds the file-level import graph —
  the two may fire on the same repo but never on the same edge.
- Diff scope (`--scope changed`), CI/agent surfaces, new dependencies,
  exit-code/`schemaVersion`/CLI/reporter changes.

## User stories

1. As a backend developer, I run `backend-doctor scan .` and see each file
   stuck in an import cycle (with the whole chain spelled out), each file
   nothing reaches from my entry points, each export that drifted out of
   use, and each declared dependency my code stopped importing — each
   message naming the concrete fix, without flagging my entry files, my
   barrel re-exports, or the tooling in my devDependencies.
2. As a CI author, the pack behaves like every other pack: `warn` by
   default so exit code stays 0 until I promote rules, `--format
   json|jsonl` unchanged, consecutive runs byte-identical, and a crashing
   graph rule degrades to an `internal` diagnostic instead of failing the
   build.
3. As an AI agent, I consume the same JSON/JSONL as before — no new schema
   surface — and every finding cites a rule doc at
   `docs/rules/backend-doctor/<rule-id>.md`.

## Contract / Model

No changes to the JSON report, diagnostic shape, CLI surface, config
fields, or exit codes. New stable surfaces: the four rule ids, plus the
internal project-rule kind (engine-internal, not exported from
`src/index.ts`).

### Engine: project rules (second rule kind)

- `ProjectRuleDefinition`: identity fields identical to `RuleDefinition`
  (`id`, `title`, `category`, `severity`, `docs`, `frameworks?`), with an
  `analyze(project)` body instead of `create(ctx)`. It receives all
  analyzed `SourceFileView`s, the package root path, the parsed
  `package.json` dependency keys, and a report sink accepting
  `{ file, node?/line?/column?, message }` (file = a `SourceFileView` of
  the file the finding is against; `package.json` findings use a
  line/column against the package root's `package.json`).
- Registration: the product registry (`src/rules/index.ts`) keeps a single
  explicit list; the engine dispatches file rules in the per-file loop and
  project rules in one pass after it. The registry-count assertion grows
  34 → 38.
- Gates (runner, shared with file rules): pack gate, `config.ignore.rules`,
  severity resolution (`rules[id]` > `categories[category]` > default,
  `off` silences, `error` escalates → exit 1). A throwing `analyze` is
  isolated: partial findings discarded, one `internal` diagnostic at 1:1
  plus a `skippedChecks` entry, scan continues.

### Import graph (engine module)

- Nodes: analyzed files (absolute paths from the sorted collect list).
- Edges: file A → file B when a relative specifier of A resolves to B
  (candidates: literal specifier; `.js`/`.mjs`/`.cjs` →
  `.ts`/`.mts`/`.cts`; plus `/index` variants). Non-relative specifiers are
  package imports; self-edges are dropped; unresolvable edges are dropped.
- Entries: package.json `main` and `bin` (string or object values)
  resolved to existing analyzed files, plus `src/main.ts`, `src/index.ts`,
  `main.ts`, `index.ts` if they exist under the package root.
- Derived data: cycle membership (strongly connected components with >1
  node, or a self-loop — self-loops are dropped as edges, so only >1),
  reachability from entries, and per-file exported-symbol usage.

### Rules (default severity `warn`, no framework gate)

| Rule id | Category | Fires at | One diagnostic per |
|---|---|---|---|
| `backend-doctor/circular-dependency` | Architecture | the file's first import edge inside the cycle (fallback 1:1) | file participating in a cycle |
| `backend-doctor/unused-file` | Maintainability | the file (1:1) | file unreachable from every entry |
| `backend-doctor/unused-export` | Maintainability | the export declaration | exported symbol with no importer |
| `backend-doctor/unused-dependency` | Maintainability | `package.json` 1:1 | declared, unreferenced `dependencies` entry |

Message templates (exact strings, snapshot-pinned):

- `circular-dependency`: `<chain> form an import cycle; circular imports
  hide initialization order and break tree-shaking. Break the cycle by
  moving the shared code into a module both sides can import.` — `<chain>`
  is the full `a.ts -> b.ts -> a.ts` walk (target-relative posix paths,
  smallest member first).
- `unused-file`: `Nothing imports this file and it is not an entry point;
  it is compiled and maintained but never runs. Delete it, expose it
  through an entry, or import it where it is meant to be used.`
- `unused-export`: `<name> is exported here but no other file imports it;
  it is public API nobody uses. Remove the export keyword, inline the
  code, or delete it.`
- `unused-dependency`: `<name> is declared in dependencies but no
  analyzed file imports it. Remove it from package.json or move it to
  devDependencies if only tooling uses it.`

## EARS acceptance criteria

- **AC-1:** WHEN the import graph of the analyzed files contains a cycle
  (a → b → a, possibly longer), THE SYSTEM SHALL report exactly one
  `circular-dependency` diagnostic (warn, Architecture) per file in the
  cycle, positioned at its first import edge participating in the cycle,
  with the canonical chain in the message; WHEN the graph is acyclic, THE
  SYSTEM SHALL NOT report.
- **AC-2:** WHEN at least one entry file exists and an analyzed file is
  unreachable from every entry through import edges, THE SYSTEM SHALL
  report exactly one `unused-file` diagnostic (warn, Maintainability) for
  it; WHEN the file is reachable, is itself an entry, or no entry file
  exists, THE SYSTEM SHALL NOT report.
- **AC-3:** WHEN a non-entry file exports a symbol (named or default) that
  no other analyzed file uses — by named/default import, or through a
  namespace/side-effect/`require`/dynamic-import/re-export of the file —
  THE SYSTEM SHALL report exactly one `unused-export` diagnostic (warn,
  Maintainability) at the export declaration; WHEN the symbol is imported
  by name, the file is an entry file, or the export is a re-export
  (`export … from`), THE SYSTEM SHALL NOT report.
- **AC-4:** WHEN a `package.json` `dependencies` entry is referenced by no
  analyzed module specifier and mentioned by no `scripts` string, THE
  SYSTEM SHALL report exactly one `unused-dependency` diagnostic (warn,
  Maintainability) against `package.json`; WHEN the package is imported
  (directly or by subpath), mentioned in `scripts`, declared under
  `devDependencies`, matches `@types/*`, or uses a non-registry protocol,
  THE SYSTEM SHALL NOT report.
- **AC-5:** WHEN a project rule's `analyze` throws, THE SYSTEM SHALL emit
  one `internal` diagnostic and a `skippedChecks` entry for it and keep
  every other rule's findings (constitution §8).
- **AC-6:** WHEN the tree contains none of the pack's triggers, THE SYSTEM
  SHALL produce no diagnostics from this pack; config
  `ignore.rules`/severity `off` silence a graph rule and severity `error`
  escalates it (exit code 1 when such diagnostics exist) — the same
  resolution matrix as file rules.
- **AC-7:** WHEN the same tree is scanned twice, THE SYSTEM SHALL produce
  byte-identical JSON reports.
- **AC-8:** WHEN the scan target is a single file or a tree without
  package.json, THE SYSTEM SHALL run the graph rules without crashing
  (degenerate graph: no cycles; no entries → `unused-file`/`unused-export`
  silent; no `dependencies` → `unused-dependency` silent).
- **AC-9:** WHEN the feature ships, every pack rule SHALL have multi-file
  `valid/` and `invalid/` fixture trees, snapshot tests of the exact
  diagnostics, and a markdown doc at `docs/rules/<rule-id>.md`
  (constitution §3).

## Testing strategy (TDD)

- **Fixtures.** Graph rules need multi-file trees, so the pack gets a new
  fixture root `tests/fixtures/graph/<rule-id>/{valid,invalid}/` (the
  `nest/` precedent: fixtures shaped by what the analysis needs):
  - `circular-dependency/` — invalid: a three-file cycle `a → b → c → a`
    plus a fourth file importing the cycle from outside; valid: an acyclic
    chain, an import of a non-analyzed path, a file importing itself.
  - `unused-file/` — invalid: a tree with `src/main.ts` importing one
    module while a sibling module hangs unimported; valid: the same tree
    fully reachable, and a tree with no entry file at all (rule silent).
  - `unused-export/` — invalid: a non-entry file exporting a function and
    a class nothing imports alongside one used export; valid: exports
    consumed by named/default/namespace imports, by a side-effect import,
    by a `export … from` barrel, and exports in `src/main.ts` (entry
    exemption).
  - `unused-dependency/` — invalid: `package.json` with an unused
    `dependencies` entry beside used ones; valid: devDependencies-only
    trees, `@types/*`, `workspace:` protocols, a package mentioned only in
    `scripts`.
- **Unit** — new `tests/unit/engine/imports.test.ts`: the pure graph
  machinery (specifier resolution incl. `.js`→`.ts` and `/index`
  variants, entries detection, cycles, reachability) on temp trees; new
  `tests/unit/rules/graph.test.ts`: the four rules over the fixture trees
  with exact diagnostics (file, line, column, message, severity,
  category), the fail-soft isolation case (AC-5), the config
  off/error cases (AC-6), and fixture/doc existence (AC-9). Registry count
  34 → 38 in `tests/unit/rules/blocking.test.ts`.
- **Integration** — extend `tests/integration/scan.test.ts`: a staged tree
  with a cycle, an orphan file, an unused export and an unused dependency
  produces all four through `runScan`; determinism of the combined report.
- **e2e** — new `tests/e2e/graph-rules.test.ts` via
  `runCli`/`makeTmpDir`/`expectSuccess`: JSON diagnostics for the four
  violations; two runs byte-identical (AC-7); `off`/`error` overrides incl.
  exit 1 (AC-6); jsonl stays diagnostics-only; a single-file scan target
  does not crash (AC-8).
- **Docs** — four rule docs under `docs/rules/backend-doctor/` in the
  existing format, with the recall holes (dynamic specifiers, string-based
  usage, workspace scripts) written down. New durable facts (`.js`→`.ts`
  resolution mappings, entry heuristics) go to `docs/RESEARCH.md`.
- **Adapter growth** — none expected: edges come from the existing
  `getModuleSpecifiers()`, positions from in-rule AST walks over
  `forEachDescendant` (import/export declarations are plain nodes). The
  engine grows the project-rule kind and the graph module, not the parser
  boundary.

## Open questions for review

1. **"Opt-in" (PLAN phase header) vs. warn-by-default.** PLAN's Phase 3 is
   labeled "Project-level (opt-in, full scan)". Recommendation: ship all
   four enabled at `warn` like every existing pack — exit code stays 0
   until a rule is promoted, users opt out via `ignore.rules`, and this
   matches constitution §2 ("new rules start as warn"); making rules
   default-`off` would be a first (the severity type only allows
   error/warn defaults) and would hide the pack from every existing
   consumer. Alternative: literal opt-in — ship them disabled by default
   (small severity-type change) until F022 proves their precision.
2. **Cycle reporting granularity.** Recommendation: one diagnostic per
   file participating in a cycle (each file is half of the problem; CI
   annotations then point at every involved file), with the canonical
   chain in each message. Alternative: one diagnostic per cycle at the
   first edge (quieter, but the other members get no annotation).
3. **Entry-file heuristic breadth.** Recommendation: `package.json`
   `main`/`bin` + `src/main.ts`/`src/index.ts`/`main.ts`/`index.ts`, and
   total silence when none exists (the precision escape hatch for
   libraries with unusual entries). Alternative: also treat
   `*.module.ts`/`*.controller.ts` as roots (Nest-isms) — rejected
   internally: imports already reach them from `main.ts`, and it would
   silence real orphans.
4. **`unused-dependency` scope.** Recommendation: `dependencies` only
   (never `devDependencies` — binaries/configs live there and would FP),
   excluding `@types/*` and `workspace:`/`file:`/`link:` protocols, with
   `scripts` mentions counting as usage. Alternative: also cover
   `devDependencies` imports that only configs reference — high FP risk,
   deferred.
5. **New dependencies.** Recommendation: none — graph build, Tarjan-style
   SCCs and reachability are hand-rolled pure functions (the boring
   option). Alternative: a graph library — no benefit at this size.
