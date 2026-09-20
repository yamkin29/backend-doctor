# Design 013 — Graph rules: cycles & unused

## Module layout

- `src/engine/imports.ts` — the pure graph machinery (parser-agnostic,
  constitution §4): `ImportEdgeSource` (structural `{ filePath,
  getModuleSpecifiers() }` — every `SourceFileView` satisfies it),
  `buildImportGraph` (adjacency over the sorted file list),
  `resolveSpecifier` (relative-specifier → analyzed file, with the
  `.js→.ts` / `.mjs→.mts` / `.cjs→.cts` mappings and `/index` variants),
  `findEntryFiles` (main/bin + conventional entries), SCC cycles with a
  canonical simple chain, `reachableFrom`. All inputs/outputs are plain
  strings and sets — unit-testable without the adapter.
- `src/engine/project-rules.ts` — the second rule kind:
  `ProjectRuleDefinition` (identity fields as `RuleDefinition`, body
  `analyze(project)`), `ProjectRuleContext` (`files`, `graph`, `entries`,
  `dependencies`, `scripts`, `positionOf(file, node)`, `report`),
  `runProjectRules` (gates + fail-soft + diagnostic stamping, mirroring
  `runRules`), `readPackageJsonSurface` (dependencies keys + scripts
  strings, fail-soft skippedChecks like `detect.ts`).
- `src/engine/registry.ts` — `registerProjectRule`, `allProjectRules`,
  `ProjectRuleDefinition` re-export; `allRules()` keeps returning file
  rules only so the per-file loop is unchanged.
- `src/core/scan.ts` — one new block after the per-file loop: read the
  package surface, run project rules, merge diagnostics/skippedChecks.
- `src/rules/graph/circular-dependency.ts`, `unused-file.ts`,
  `unused-export.ts`, `unused-dependency.ts` — the four rules.
- `src/rules/index.ts` — second explicit array `productProjectRules`,
  registered next to `productRules` (boring, greppable).
- `tests/fixtures/graph/<rule-id>/{valid,invalid}/` — multi-file fixture
  trees (the `nest/` precedent).
- `tests/unit/engine/imports.test.ts` — pure machinery tests on stub edge
  sources and temp trees.
- `tests/unit/engine/project-rules.test.ts` — the rule kind itself: gate
  matrix, fail-soft isolation, finding stamping, package-surface reading.
- `tests/unit/rules/graph.test.ts` — the four rules over fixture trees
  with exact diagnostics + existence assertions.
- `tests/unit/rules/blocking.test.ts` — registry count 34 → 38 (file +
  project product rules).
- `tests/integration/scan.test.ts` — staged tree through `runScan`.
- `tests/e2e/graph-rules.test.ts` — bin-level tests.
- `docs/rules/backend-doctor/{circular-dependency,unused-file,
  unused-export,unused-dependency}.md` — four rule docs.

## Key decisions

1. **Graph edges from the existing adapter surface only.**
   `buildImportGraph` consumes `getModuleSpecifiers()` per file plus plain
   path math; ts-morph's dependency resolver is not consulted
   (constitution §4). Resolution candidates for a relative specifier `s`:
   `s` itself; `s` with `.js/.mjs/.cjs` swapped to `.ts/.mts/.cts` (the
   ESM-style TS import idiom — this repository's own sources use it);
   both forms with `/index` appended when the path has no extension. The
   first candidate that is an analyzed file wins; otherwise no edge. Bare
   specifiers never form edges; self-edges are dropped.
2. **Cycles via SCC, message via canonical simple chain.** Strongly
   connected components with more than one node are the cycle members
   (self-edges are already dropped). For each SCC the message chain is
   produced by a DFS from the lexicographically smallest member following
   sorted edges until it returns to the start — deterministic, and for the
   dominant real shape (simple rings) it is exactly the ring. One
   diagnostic per member file (resolution 2), positioned at the file's
   first import statement whose specifier resolves into the same SCC
   (fallback 1:1); the rule re-walks the file's specifiers in order via
   the graph's `resolve` so position and edge agree.
3. **Unused-file = reachability, silence without entries.** Entries:
   `package.json` `main` and `bin` (string form, or the string values of
   the object form) resolved to analyzed files, plus
   `src/main.ts`/`src/index.ts`/`main.ts`/`index.ts` when they exist
   (resolution 3). No entries → the rule returns immediately: an
   unreachable graph proves nothing. Reachability is a plain DFS from the
   entries over forward edges.
4. **Unused-export usage model.** For every file, one AST walk collects
   `import`/`export-from` usage per resolved target: named imports (and
   named re-exports) use exactly their imported names (alias-aware via
   the property name); default imports use `default`; namespace imports,
   side-effect imports, `require`, dynamic `import()`, and `export *`
   use *all* exports of the target. A second walk collects a file's own
   exports: `export`-keyword declarations (function, class, interface,
   type alias, enum, variable statement — declaration-list names
   individually), local `export { a, b }` lists, and `export default`;
   export declarations *with* a module specifier are pass-throughs — they
   are usage of the target and not exports of the re-exporting file.
   Entry files are exempt entirely (their exports are the public
   surface); self-edges are dropped so a file cannot use its own exports.
5. **Unused-dependency scope (resolution 4).** Only `dependencies` keys;
   `@types/*` and keys carrying a protocol prefix (`workspace:`,
   `file:`, `link:`, …) never fire; a key is *used* when some analyzed
   module specifier equals it or extends it (`name/...`), or when any
   `scripts` string contains it (bin usage). The finding is stamped
   against `<packageRoot>/package.json` at 1:1 with the name in the
   message — package.json is not an analyzed file, but diagnostics only
   need a path, and the report sort keeps the position deterministic.
6. **Same gates, same fail-soft, second dispatch.** `runProjectRules`
   reuses `resolveSeverity` and the pack-gate/`ignore.rules` checks
   verbatim; a throwing `analyze` discards its partial findings and emits
   one `internal` diagnostic + `skippedChecks` entry (constitution §8).
   The registry grows `registerProjectRule`/`allProjectRules`; the
   per-file `allRules()` contract is untouched, so `runRules` and every
   existing pack are unaffected.
7. **Registry count 34 → 38.** The blocking.test.ts assertion counts file
   + project product rules (allRules().length + allProjectRules().length),
   stepping 35 → 38 across the four rule tasks.
8. **Determinism.** The graph is built from the sorted collect list;
   sets are only membership-tested, every iteration that produces output
   walks sorted keys; chains and messages are derived from file-local
   facts. No clocks, no environment reads.
9. **Fixture trees, not flat files.** The graph is inherently multi-file,
   so the pack gets `tests/fixtures/graph/` (the `nest/` precedent of
   fixture shape following analysis needs); unit tests drive
   `runProjectRules` directly over the adapter's views, exactly like
   `scanNestFixture` drives `runRules`.

## Dependencies

None (resolution 5). SCC and reachability are hand-rolled DFS over plain
maps; no package.json change.

## Test map (AC → test)

| AC | Test |
|---|---|
| AC-1 | `tests/unit/rules/graph.test.ts` — `circular-dependency` invalid tree (3-file ring + outside importer) exact diagnostics incl. canonical chain message and first-participating-import positions; valid tree (acyclic chain, non-analyzed import, self-import) → `[]`; existence |
| AC-2 | same file — `unused-file` invalid tree (orphan beside a reachable module, entry present) exact diagnostics; valid tree (fully reachable; and an entry-less tree → silent); existence |
| AC-3 | same file — `unused-export` invalid tree (unused function + class beside a used export, non-entry) exact diagnostics; valid tree (named/default/namespace/side-effect/barrel usage; entry exemption); existence |
| AC-4 | same file — `unused-dependency` invalid tree (unused dependency beside used ones) exact diagnostics; valid tree (devDependencies only, `@types/*`, `workspace:` protocol, scripts mention); existence |
| AC-5 | `tests/unit/engine/project-rules.test.ts` — a throwing project rule yields one `internal` diagnostic + skippedChecks entry and sibling rules still report |
| AC-6 | `tests/unit/engine/project-rules.test.ts` — pack gate (`frameworks`), `ignore.rules`, severity `off`/`error` matrix for project rules; `tests/e2e/graph-rules.test.ts` — config `off`/`error` incl. exit 1 through the bin |
| AC-7 | `tests/e2e/graph-rules.test.ts` — two `runCli --format json` runs, byte-identical stdout |
| AC-8 | `tests/e2e/graph-rules.test.ts` — single-file scan target runs clean; `tests/unit/engine/imports.test.ts` — empty/degenerate graphs (no entries, no package.json surface) |
| AC-9 | existence assertions in `tests/unit/rules/graph.test.ts` (`valid/`+`invalid/` trees and `docs/rules/<id>.md` for all four rules) plus the snapshots themselves |
