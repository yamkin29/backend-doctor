# RESEARCH — adopted precedents and durable findings

Consolidated knowledge so agents do not re-research or re-trip over the same things.
Sections: precedents adopted from react-doctor (with sources for re-research), then
our own durable findings.

## React-doctor (millionco) — what we adopt and why

Repo: <https://github.com/millionco/react-doctor> · Docs: <https://www.react.doctor/docs>
(~800 rules; TS monorepo on oxlint/oxc-parser; MIT.)

| Area | Their design | Our adoption | Source |
|------|--------------|--------------|--------|
| JSON report | `schemaVersion`, `mode`, `diagnostics[]` (`id` deterministic, `normalizedFilePath`, `line`, `column`, `plugin`, `rule`, `category`, `severity`, `message`, `tags[]`), `projects[]` (`packageRoot`, `framework`, `analyzedFiles`, `analyzedFileCount`, `complete`, `skippedChecks`) | Same shape, `spec 001/003`; consumers branch on `schemaVersion` and use `complete` for coverage | `docs/json-report.md` in their repo |
| Config | `doctor.config.ts` via `defineConfig` / `.json` / package.json key; walk-up resolution to repo root; fields `rules`, `categories`, `ignore{rules,files,overrides}`, `scope`, `base`, `blocking` | `spec 002` (subset: rules, categories, ignore{files,rules}); walk-up stops after nearest `.git` | react.doctor/docs/configuration/config-files |
| Rule docs | One markdown per rule id at `/prompts/rules/{plugin}/{rule}.md` with metadata (severity, scope, evidence boundaries) — consumed by AI agents | `docs/rules/<rule-id>.md` from spec 003/006; generation script planned (F023) | react.doctor/docs/rules |
| CI | `ci install` writes workflow + composite action; diff scope via merge-base; sticky PR comment + inline review comments (cap 50) + commit status; `blocking: none` default | Planned F015/F016 verbatim in spirit | react.doctor/docs/ci-and-prs/github-actions-setup, `action.yml` |
| Agent integration | `skills/<name>/SKILL.md` (frontmatter name/description, "run after edits, scope changed"); `--format jsonl` | Planned F017 | react.doctor/docs/getting-started/install-for-coding-agents |
| Runtime engine | `scan <url>` records a Chrome DevTools trace via playwright-core; purple outlines on renders; traces local-only, flagged sensitive | Our Phase 5 analog: `probe -- <start command>` with `--require` hook, `perf_hooks.monitorEventLoopDelay` + `async_hooks` | repo `packages/core/package.json`, docs |
| Stack | oxlint plugin + oxc-parser, jiti for config loading, effect, commander, ink | We use ts-morph behind `ParserAdapter` (Engine v2 may migrate to oxc); jiti adopted for config; commander adopted; ink rejected (boring surface) | repo `packages/*/package.json` |

## Our own durable findings

### jiti v2 (config loading) — virtual `default`

Under interop, a module **without** a default export exposes a *virtual*
`mod.default` (the module itself) — via Proxy, so it is **not** an own property and
`mod.default !== mod` can still hold (wrapper vs target). Detect a real default with
`Object.getOwnPropertyNames(mod).includes("default")`. A `Proxy` may also hide
`__esModule` from `JSON.stringify` (non-enumerable) — use `in` checks and
`Symbol.toStringTag` for ESM detection. See `src/config/load.ts`, spec 002 T4.

### tsup

- Object-form `entry` (`{ "bin/backend-doctor": "src/bin/…" }`) to preserve
  `dist/bin/` layout; array form flattens.
- `dts: true` required for `exports.types`.
- Shebang: keep `#!/usr/bin/env node` in the bin **source**; a global `banner` would
  also stamp the library entry.
- `external: ["jiti"]` — its loader machinery must run as the real dependency.

### ts-morph

- **Type guards need the runtime class.** `import { type Node } from "ts-morph"`
  compiles but `Node.isImportDeclaration(...)`-style guards then fail at runtime
  with `Node is not defined`. Import `Node` as a value wherever guards are used
  (bit spec 004 T1; `parser/types.ts` re-exports it as a value for this reason).
- Dynamic `import("…")` is a CallExpression whose expression has kind
  `SyntaxKind.ImportKeyword` — collect its first StringLiteral argument for
  module specifiers (see `getModuleSpecifiers()` in `ts-morph-adapter.ts`).
- **`forEachDescendant` callback return value is traversal control.** The
  callback must return `"skip"` or `undefined` — returning any other truthy
  value (e.g. `nodes.push(n)`'s number) silently aborts the traversal. Bit
  spec 005 T1 while probing; rules keep the explicit `return undefined;`
  pattern (`no-eval` precedent).
- **`Node.isParameter` does not exist** (v28); the missing guard surfaces as
  a runtime crash inside a rule — which the runner converts into an
  `internal` diagnostic + `skippedChecks` entry (constitution §8, verified
  live in spec 005 T6). Use `node.asKind(SyntaxKind.Parameter)` instead: it
  both guards and narrows.
- **`TryStatement.getCatchClause()`** exists and returns `undefined` for a
  finally-only try — the right predicate for "guarded by try/catch"
  (`unhandled-json-parse`, spec 005).
- **`void f()` / `await f()` are structurally not statement-level
  CallExpressions** (ExpressionStatement wraps VoidExpression /
  AwaitExpression), so a "statement-level call" check suppresses them for
  free — no special cases needed (spec 005 design decision 3).
- **`while`/`do…while` conditions come from `getExpression()`, not
  `getCondition()`** (ts-morph v28): `WhileStatement`/`DoStatement` are
  built on an `ExpressionedNode` base and their runtime prototypes carry
  almost nothing; `getCondition()` exists only on `ForStatement`. Calling
  it on a while node is a runtime TypeError — which the runner converts
  into an `internal` diagnostic (constitution §8, bit spec 006 T3, caught
  by the exact-diagnostic test). Probing those prototype chains can even
  throw `InvalidOperationError` ("node has no source file") from property
  getters. Use `asKind(SyntaxKind.ForStatement)` → `getCondition()`,
  `asKind(SyntaxKind.WhileStatement / SyntaxKind.DoStatement)` →
  `getExpression()`.

### pnpm 12

- Build-script approvals live in `pnpm-workspace.yaml` → `allowBuilds: esbuild: true`
  (not `package.json#pnpm.onlyBuiltDependencies`).
- pnpm installed via homebrew; plain `pnpm` everywhere. The system corepack is broken
  (stale signing keys) — do not use it.

### Biome 2

- Tabs, double quotes, `organizeImports` on. `pnpm format` before every commit;
  it rewrites files, so re-read any file you edited after formatting.
- Markdown is not linted; JSON files are formatted.

### Shell discipline

- `set -o pipefail` for any `cmd | grep | head` chain — otherwise the pipe masks
  non-zero exits (caused two premature commits during spec 002).
- vitest `--no-cache` exists and helps when debugging transform staleness; prefer
  fixing the cause over trusting cache invalidation.

### npm names

- Taken: `node-doctor` (env diagnostics CLI), `nest-doctor` (abandoned Nest helper).
- `backend-doctor` is free — reserved for F023 publish.

### react-doctor name-check facts (for future rule packs)

- 802 active rules, 9 categories including a first-class Next.js pack (~23 rules)
  and RSC-aware bug rules — the model for our Nest pack (F008–F011) and Prisma pack
  (F012).
- Their rule objects: `defineRule` with `id`, `title`, `severity`, `recommendation`,
  `create` (AST visitors) or `scan(file)` (whole-tree findings) — two rule kinds.
  We mirror this: AST rules via the adapter now, scan/graph rules from F013.
