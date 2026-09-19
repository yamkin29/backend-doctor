# Design 003 — Engine core (F003)

- **Status:** Implemented (2026-09-19) — see deviations in [tasks.md](./tasks.md)
- **Implements:** [spec.md](./spec.md)

## Module layout

```
src/
├─ engine/
│  ├─ parser/
│  │  ├─ types.ts          # ParserAdapter, SourceFileView, RuleContext types
│  │  └─ ts-morph-adapter.ts   # the only module importing ts-morph
│  ├─ registry.ts          # RuleDefinition, defineRule, registerRule, allRules()
│  ├─ diagnostic-id.ts     # deterministic id: file::line:col::rule::digest
│  ├─ severity.ts          # resolution matrix (rules > categories > default)
│  └─ runner.ts            # runRules(file, rules, config) → diagnostics
├─ rules/
│  ├─ index.ts             # explicit registry array (boring, greppable)
│  └─ security/
│     ├─ no-eval.ts        # seed rule
│     └─ no-new-func.ts    # seed rule
└─ core/scan.ts            # stub replaced: collect → parse → run rules → report
tests/
├─ fixtures/engine/bad-app/   # committed fixture project with known violations
└─ unit/engine/…              # adapter, severity, ids, runner, seed rules
docs/rules/backend-doctor/{no-eval,no-new-func}.md
```

## New dependency

`ts-morph` (installed latest, exact minor pinned). Everything else is already in
place (picomatch from F002).

## Key decisions

1. **ParserAdapter is a module boundary, not a type universe.** `src/engine/parser/`
   exports the `ParserAdapter` interface, `SourceFileView` and re-exports the node
   types rules need. Only `ts-morph-adapter.ts` imports ts-morph directly
   (proposed constitution §4 interpretation — see spec open question 2).

   ```ts
   interface ParserAdapter {
     readonly name: string;                       // "ts-morph"
     createProject(filePaths: string[]): SourceFileView[]; // sync for MVP
     positionOf(file: SourceFileView, pos: number): { line: number; column: number };
   }
   interface SourceFileView {
     readonly filePath: string;                   // absolute
     getRelativePath(target: string): string;
     forEachDescendant(cb: (node: Node) => void | "skip"): void;
     getText(node?: Node): string;
   }
   ```

   Rules stay parser-agnostic at the *module* level; an oxc migration will
   reimplement the adapter and rewrite rule internals (accepted tradeoff).

2. **File collection precedes parsing** and is adapter-independent: a pure
   `collectFiles({ target, extensions, excludes, ignoreGlobs })` returns sorted
   absolute paths. Sorting here guarantees deterministic report order. picomatch
   with `dot: true` matches paths relative to the scan target.

3. **No tsconfig in F003.** ts-morph `Project` is created without
   `tsConfigFilePath`; files are added explicitly from the collector. tsx parsing
   works from the extension (scriptKind inferred); type-aware rules come later.

4. **RuleContext carries the reporter:**

   ```ts
   interface RuleContext {
     file: SourceFileView;
     report(input: { node?: Node; line?: number; column?: number; message: string }): void;
   }
   ```

   `report` resolves 1-based positions via the adapter when given a node; the
   runner stamps rule/category/severity/tags/id — rules never touch ids or
   severity.

5. **Runner shape:** for each file, for each enabled rule: `try { rule.create(ctx) }
   catch (e) { internal diagnostic + skippedChecks.push(...) }`. Enabled = severity
   resolved ≠ off and id not in `ignore.rules`. Diagnostics accumulate globally,
   then sort by (relativeFile, line, column, rule id) once at the end.

6. **Diagnostic id:** `sha256(`${file}::${line}:${col}::${rule}::${message}`)`
   → first 8 hex chars appended after the human-readable prefix. Pure function,
   unit-tested for stability.

7. **Severity resolution is a pure function** (`severity.ts`):
   `resolveSeverity({ ruleId, category, default, config }) → "error" | "warn" | "off"`,
   matrix-tested (9-cell + off/ignore.rules cases).

8. **Seed rules implementation:** single visitor each —
   `no-eval`: CallExpression whose expression is the identifier `eval` (plus
   `(0, eval)` indirect form via comma expression check);
   `no-new-func`: NewExpression with identifier `Function`.
   Both report "Prefer … instead of …" messages with a fix hint in the doc, not in
   the message (messages stay short).

9. **`core/scan.ts` real pipeline:**

   ```
   collectFiles → adapter.createProject → for each file: runRules
   → assemble ScanResult { diagnostics, projects[] } → buildReport (unchanged)
   ```

   `projects[0]` = `{ packageRoot: nearest package.json dir (walk-up from target,
   fallback target), frameworks: [], analyzedFiles, analyzedFileCount, complete:
   true, skippedChecks }`. Reporter/exit-code layers untouched.

10. **Fixture project** `tests/fixtures/engine/bad-app/` — committed, minimal:
    `package.json`, `tsconfig.json` (decorations for later), `src/index.ts`
    containing one `eval("1")` and one `new Function("return 1")`, plus a clean
    `src/util.ts`. e2e asserts exact expected diagnostic set.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | unit: collectFiles on temp tree — extensions, default excludes, dotfiles, ignore globs, sorted output |
| AC-2 | unit: unreadable file → skippedChecks entry, scan continues; integration on fixture |
| AC-3 | unit: runner stamps positions/category/severity; seed-rule fixtures |
| AC-4 | unit: diagnostic-id stable across calls & runs; changes when message changes |
| AC-5 | unit: severity matrix (rules > categories > default; off; ignore.rules) |
| AC-6 | unit: throwing fixture rule → internal diagnostic + skippedChecks; other rules still run |
| AC-7 | e2e: bad-app via bin — pretty/json/jsonl contain diagnostics; exit 1 with `no-eval: error` config, exit 0 with warn default |
| AC-8 | e2e: json `projects[0]` — packageRoot, analyzedFiles sorted, counts, complete |
| AC-9 | unit: disabled/off/unknown-ignored rules never invoked (spy fixture rules) |
| AC-10 | e2e: two consecutive json runs byte-identical |
