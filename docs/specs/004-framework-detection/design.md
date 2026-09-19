# Design 004 — Framework detection (F004)

- **Status:** Implemented (2026-09-19) — see deviations in [tasks.md](./tasks.md)
- **Implements:** [spec.md](./spec.md) (all open questions resolved as recommended)

## Module layout

```
src/
├─ framework/
│  ├─ markers.ts      # FRAMEWORK_MARKERS — the spec's detection matrix as data
│  └─ detect.ts       # detectFrameworks({packageRoot, scanRoot, files})
├─ engine/parser/types.ts             # SourceFileView gains getModuleSpecifiers()
├─ engine/parser/ts-morph-adapter.ts  # the only ts-morph import: implements it
├─ engine/registry.ts                 # RuleDefinition gains frameworks?
├─ engine/runner.ts                   # detectedFrameworks gate in runRules
└─ core/scan.ts                       # wire detection, fill projects[0].frameworks
tests/
├─ unit/engine/parser/ts-morph-adapter.test.ts  # + module-specifier collection
├─ unit/framework/detect.test.ts                # new — detection matrix on temp trees
├─ unit/engine/runner.test.ts                   # + pack gate describe
├─ unit/reporters.test.ts                       # + pretty frameworks line
├─ integration/scan.test.ts                     # + end-to-end frameworks + fail-soft
└─ e2e/framework.test.ts                        # new — contract through the bin
```

No new dependencies (spec open question 6).

## Key decisions

1. **The matrix is data, detection is a pure function.** `markers.ts` mirrors the
   spec table verbatim — per framework: exact `dependencies` keys, exact and
   prefix module-specifier matchers, file-marker paths relative to packageRoot.
   `detectFrameworks` unions the three sources per framework, dedupes and sorts.
   Alternative: detection folded into `engine/` — rejected; PLAN assigns
   `src/framework/`, and a pure function is testable without the pipeline.

2. **Adapter grows first (constitution §4):** `SourceFileView.getModuleSpecifiers()`
   returns module specifiers from static imports, dynamic `import("…")` and
   `require("…")` calls. AST-derived, so occurrences in comments/unrelated strings
   never match. Alternative: regex over `getText()` — rejected (false markers in
   comments); alternative: also collect `export … from "…"` — rejected for F004,
   the spec contract lists imports/require/dynamic import only (additive later).

3. **Dependencies = exact keys of `package.json#dependencies` only** (approved open
   question 1). Versions ignored; dev/peer deps ignored; shape violations
   (non-object root or `dependencies`) count as unparseable → `skippedChecks`.

4. **Gate lives in the runner, next to the other enable checks.**
   `RunRulesOptions.detectedFrameworks: readonly string[]` (required — the scan
   always knows the result; call sites state intent). A rule runs iff its
   `frameworks` field is empty/absent or every declared framework is detected.
   A gated-off rule is disabled by design — no diagnostic, no `skippedChecks`,
   same visibility contract as severity `off`. Alternative: filter rules in
   `scan.ts` — rejected; enablement policy already lives in the runner
   (`ignore.rules`, severity `off`).

5. **Registration stays eager, config validation untouched** (approved open
   question 5): pack rule ids are in `allRules()`, so `knownRuleIds`
   (`src/cli/commands/scan.ts:23`) accepts them on any project — AC-11's
   "no exit 2" falls out of existing behavior and needs no new code.

6. **package.json failure semantics:** `existsSync` → missing file is a normal
   state (deps = ∅, no `skippedChecks` entry, code/file markers still apply);
   read/parse/shape failures produce `{ check: "framework-detection", reason }`
   with a target-relative path prefix, consistent with the existing `read`
   entries. `scanRoot` is passed to `detectFrameworks` for those relative paths
   because packageRoot may sit *above* the scan target (walk-up).

7. **Pipeline order in `runScan`:** collect → parse → detect (packageRoot
   hoisted out of the `projects` assembly, one `findPackageRoot` call) → run
   rules with `detectedFrameworks` → `projects[0].frameworks` filled from the
   detection result. Detection `skippedChecks` merge after the read failures,
   before rule-crash entries (deterministic insertion order).

8. **Pretty reporter (approved open question 4):** one `Frameworks: nest, prisma`
   line directly under `Directory:`, rendered only when non-empty — reports for
   framework-less trees stay byte-identical to today (bad-app e2e untouched).

9. **AC-11 testability:** no product pack rule exists yet (F008/F012), so the
   full e2e flavor of AC-11 arrives with the first pack rule. F004 proves its
   substance at unit level: a fixture rule with `frameworks` plus a config
   severity entry — the gate wins (rule not run, no diagnostics), and
   `validateUserConfig` accepts the id when `knownRuleIds` comes from a registry
   containing pack rules (eager registration). Recorded in the test map and in
   tasks.md.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | unit framework/detect.test.ts — `@nestjs/common`/`@nestjs/core` deps → `nest` |
| AC-2 | unit — `express` dep → `express` |
| AC-3 | unit — `fastify` dep → `fastify` |
| AC-4 | unit — `@prisma/client` dep OR `prisma/schema.prisma` → `prisma` |
| AC-5 | unit adapter — import/require/dynamic-import specifier collection; unit detect — import-only activation without package.json; integration — same through runScan |
| AC-6 | unit — no markers → `[]` |
| AC-7 | unit — several frameworks at once → deduped, alphabetically sorted |
| AC-8 | unit — unreadable/malformed package.json → `skippedChecks` + markers still work; integration — same end-to-end in `projects[0].skippedChecks` |
| AC-9/10 | unit runner — gated rule skipped when framework undetected, runs when detected; unconditional rules unaffected |
| AC-11 | unit runner — config severity on a gated rule → not run, no diagnostics; unit config — pack id accepted by validation |
| AC-12 | unit — `@nestjs/cli`, `@nestjs/testing`, `@types/express`, `fastify-plugin`, `@fastify/*` activate nothing |
| AC-13 | e2e framework.test.ts — two consecutive bin runs byte-identical |
| AC-14 | e2e — json `projects[0].frameworks`, schemaVersion/exit codes unchanged, jsonl shape unchanged; unit reporters — pretty line; scan-engine.test.ts untouched (bad-app pins `[]`) |
