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
- **`TemplateExpression.getSpans()` does not exist** (v28) — the method is
  `getTemplateSpans()` (plus `getHead()`); the phantom method surfaces as a
  runtime TypeError caught by the helper unit test (bit spec 007 T2). Same
  family as the `while.getCondition()` trap below: probe the prototype
  chain before trusting a ts-morph method name.
- **`VariableDeclaration` position is the declarator name, not the
  statement.** `const apiKey = …` starts at the column of `apiKey`, one
  tab past the line start; `Node.getStart()` of a statement-level call is
  its callee's start. Fixture positions are easiest pinned by letting the
  first failing test print the real coordinates (spec 007 T3–T8).
- **`TryStatement.getCatchClause()`** exists and returns `undefined` for a
  finally-only try — the right predicate for "guarded by try/catch"
  (`unhandled-json-parse`, spec 005).
- **`CatchClause.getBlock()`, not `getBody()`** (v28): a catch clause's block
  is `block` in the compiler AST, so the wrapper follows the compiler name;
  `getBody` surfaces as a runtime "not a function" crash inside the rule,
  caught by the exact-diagnostic test (bit spec 011 T1). The body block's
  `getFullText()` spans the comments *inside* the braces — the deterministic
  way to tell `catch {}` from `catch { /* deliberate */ }` (strip
  braces/whitespace); a comment after the closing brace is outside
  `getFullText()`.
- **Chained-call receivers unwrap through member accesses, not straight to
  the root** (spec 011 T2): `res.status(500).json(…)` — the json call's
  receiver is the CallExpression `res.status(500)`, whose expression is the
  PropertyAccessExpression `res.status`, and only then the `res` identifier.
  A chain walker that handles calls/parens but not member accesses silently
  matches nothing. Same family as the naming traps above: probe with a real
  chain before trusting the walk.
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

### Decorator extraction (spec 008)

- **Class and method `getStart()` spans include decorators.** A decorated
  class positions at the leading `@` of its first decorator; an undecorated
  `export class` positions at the `export` keyword. Model entries in
  `src/framework/nest/` pin fixture coordinates on this basis.
- **Decorated *parameters* position at the leading `@` too** (spec 009): a
  `@Inject(…)`-decorated constructor parameter starts at the `@`, an
  undecorated one at its first modifier (`private`). Pin DI-edge coordinates
  from real runs, not by counting characters.
- **Decorated *properties* complete the pattern** (spec 010): a
  `@ApiProperty()`-decorated class property also starts at the leading `@`.
  Anything decorated positions at its first decorator; only plain
  declarations position at the declaration keyword.

### Property and method readers (spec 010)

- **`MethodDeclaration.getScope()` exists on v28** and returns
  `"public" | "protected" | "private"` from the modifier list — the clean way
  to count public API (properties expose it too). `isStatic()` pairs with it.
- **`PropertyDeclaration.getInitializer() !== undefined`** is the reliable
  "has initializer" test; `getTypeNode()?.getText()` returns `undefined` for
  untyped properties and keeps source whitespace otherwise (`"Array < any >"`)
  — collapse with `replace(/\s+/g, "")` before comparing type text.
- **`DefaultClause` is a separate `SyntaxKind` from `CaseClause`** — a branch
  census that counts `CaseClause` only is cyclomatic-aligned (the default arm
  is the fall-through path, not a new branch). All of `IfStatement`,
  `ForStatement`, `ForOfStatement`, `ForInStatement`, `WhileStatement`,
  `DoStatement`, `ConditionalExpression`, `CaseClause` appear as distinct
  descendant kinds under the enclosing node.
- **No `getDescendantsAtKind` on function/method nodes** (v28) — use
  `forEachDescendant` with a `getKind()` census (same family as the missing
  `Node.isParameter` guard).
- **Read decorator arguments through `Decorator.getCallExpression()`**, then
  `getArguments()[0]`; a bare `@Decorator` (no call) has no arguments.
  `StringLiteral.getLiteralText()` returns the unquoted value (`getText()`
  keeps the quotes — wrong for route strings).
- **Decorator name: unwrap `getExpression()` yourself** (CallExpression →
  its callee; Identifier → text; PropertyAccessExpression → `getName()`).
  `Decorator.getName()` exists but the unwrap is what survives namespace
  decorators (`@Ns.Mod`) predictably.
- **Array spreads have no `Node.isSpreadElement`-style trust** — distinguish
  by `element.getKind() === SyntaxKind.SpreadElement` (same family as the
  missing `Node.isParameter`). Object-literal spreads DO have
  `Node.isSpreadAssignment`.
- **`PropertyAssignment.getName()`/`getInitializer()` and
  `ObjectLiteralExpression.getProperties()`** are the safe way to read
  decorator metadata; `getProperty(name)` is fine too but iteration lets you
  report spreads/computed keys instead of silently skipping them.

### Constructor injections (spec 009)

- **Skip the type-checker entirely for DI edges.** A constructor parameter is
  a class edge when `getTypeNode().getText()` matches
  `/^[A-Za-z_$][A-Za-z0-9_$]*$/` — bare identifiers only, so primitives,
  generics (`Foo<Bar>`) and qualified names (`ns.Foo`) fall out for free.
  This avoids probing `TypeReferenceNode`-family guards (the prototype-chain
  trap above) entirely.
- **`cls.getConstructors()[0]`** is enough — TS classes have at most one
  constructor and the array is empty when there is none. No
  `ConstructorDeclaration` re-export is needed; inference carries the types.
- **Parameter decorators read like class decorators:**
  `parameter.getDecorators()` + the same trailing-identifier unwrap detects
  `@Optional` (skip the edge) and `@Inject(forwardRef(() => X))` (the
  forwardRef flag).

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
