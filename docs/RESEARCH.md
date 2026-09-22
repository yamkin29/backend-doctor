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
- **Template literals come in two kinds** (spec 012): a span-free backtick
  string (`` `SELECT 1` ``) is a `NoSubstitutionTemplateLiteral`, NOT a
  `TemplateExpression` — only templates with at least one `${…}` parse as
  `TemplateExpression`. A "has interpolation" check must treat the two
  kinds separately or static templates fall through to the dynamic case.
- **Tagged templates are not CallExpressions** (spec 012):
  `` prisma.$queryRaw`…` `` is a `TaggedTemplateExpression`, so
  callee-matching call collectors never see it — the parameterized safe
  form is invisible to a raw-query rule by construction. Conversely, a
  tagged template *argument* (`$queryRawUnsafe(Prisma.sql`…`)`) is reached
  via the tag (`getTag()`), which needs `TaggedTemplateExpression` named in
  a signature — the parser boundary grew a type-only re-export for it.
- **`CallExpression.getArguments()[0]` is `Node`-typed** (spec 012): after
  excluding `Node.isSpreadElement` the element is still not an `Expression`
  to the type system; the established `argument as Expression` cast
  applies (`no-ssrf.ts`, `no-unsafe-merge.ts`, prisma pack). Object-literal
  arguments additionally distinguish `PropertyAssignment` from
  `ShorthandPropertyAssignment` — `{ take }` is the shorthand kind, so a
  name census that checks only `PropertyAssignment` misses it.
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

### Import-graph resolution (spec 013)

- TypeScript sources written ESM-style import `./x.js` while the analyzed
  file is `x.ts` (this repository's own convention). A relative specifier
  must try, in order: the literal path; `.js→.ts`, `.mjs→.mts`,
  `.cjs→.cts`; both forms with `/index` appended. Bare specifiers are
  package imports, never graph edges.
- **`path.extname` lies about Nest-idiomatic stems (bit spec 022).**
  `./app.module`, `./users.service.dto` carry dots that are part of the
  name, not an extension — `path.extname` returns `.module`/`.dto`, and a
  resolver that appends candidates only for the *empty* extension silently
  kills every edge in a clean Nest app (the F022 good corpus produced 23
  unused-file/unused-export false positives before the fix). Decide by a
  known-extension set (`.ts/.tsx/.mts/.cts/.js/.mjs/.cjs`): in the set →
  swap logic; anything else → append supported suffixes. See
  `candidatePaths` in `src/engine/imports.ts`.
- Re-exports (`export … from`) and computed specifiers
  (`` import(`./x/${name}`) ``) are not edges in the adapter's
  `getModuleSpecifiers()` — documented recall hole for the graph pack.
- `circular-dependency` reports one finding per cycle *member* (a mutual
  pair yields 2 diagnostics), while `circular-di` reports once per cycle at
  the canonical provider — the two rule kinds intentionally differ.

### ts-morph v28 (spec 013 additions)

- `ImportSpecifier`/`ExportSpecifier` have **no alias accessor**
  (`getPropertyNameNode` does not exist; the prototype carries only
  `getName`/`getNameNode`/`setName`/`renameAlias`/…). `getName()` returns
  the *source* name — `import { a as b }` → `"a"` (what usage detection
  needs); for a local `export { a as b }` the exported alias `"b"` must be
  derived from `getText()` (slice after the last `" as "`).
- Span-free backtick strings are `NoSubstitutionTemplateLiteral`, not
  `TemplateExpression` — only templates with at least one `${…}` parse as
  the latter (see also the F012 note above).
- A type-only two-way import between `registry.ts` and a rule-kind module
  (`ProjectRuleContext` ↔ `ProjectRuleDefinition`) erases at compile time —
  no runtime cycle.

### New rule kinds touch config validation (spec 013)

- The scan command validates config `rules`/`ignore.rules` ids against
  `REGISTERED_RULE_IDS` (`src/cli/commands/scan.ts`). A new rule kind must
  extend that set (`[...allRules(), ...allProjectRules()]`) or configs
  naming its rules die with "unknown rule id (is it registered?)".

### react-doctor name-check facts (for future rule packs)

- 802 active rules, 9 categories including a first-class Next.js pack (~23 rules)
  and RSC-aware bug rules — the model for our Nest pack (F008–F011) and Prisma pack
  (F012).
- Their rule objects: `defineRule` with `id`, `title`, `severity`, `recommendation`,
  `create` (AST visitors) or `scan(file)` (whole-tree findings) — two rule kinds.
  We mirror this: AST rules via the adapter now, scan/graph rules from F013.

### Diff scope / git plumbing (spec 015)

- **`git rev-parse --show-toplevel` returns the realpath form of the work
  tree.** On macOS `os.tmpdir()` hands out `/var/folders/...` while git
  reports `/private/var/folders/...` — string comparison of the two spellings
  silently filters away every changed file. Canonicalize both the scan target
  and the git toplevel with `fs.realpathSync` before comparing, then map the
  result back to the target's spelling so the engine sees the same path forms
  `collectFiles` produced.
- **Path bases differ per git subcommand:** `git diff --name-only` emits
  repo-root-relative paths from any cwd, but `git ls-files --others` limits to
  and reports the *current* directory. Run every scope-related git command
  with cwd = toplevel; that is the only base where both agree.
- **`-U0` hunk headers are the only safe thing to parse in a patch.** File
  headers (`---`/`+++`) are ambiguous for spaces and affected by
  `diff.noprefix`-style config; per-file diffs
  (`git diff -U0 <base> -- <path>`) need nothing but `@@ -a[,b] +c[,d] @@`
  lines. Count-less new side = one line; count 0 = pure deletion, no range.
  Always pass `--no-ext-diff --no-textconv --no-color` so user-configured
  diff helpers never run and output stays machine-shaped.
- **Unborn `HEAD` decision order:** verify `--base` first (unresolvable →
  error, unless it is literally the default `"HEAD"`), then `HEAD` (unborn →
  everything counts as new/untracked), then `merge-base` (unrelated histories
  → error). `merge-base` fails with exit 1 and *empty* output for unrelated
  histories — the wrapper must not treat empty stdout as success.
- `git merge-base <ref> HEAD` with `<ref> === HEAD` returns HEAD's own hash,
  so the default `--base HEAD` degenerates cleanly into "diff HEAD to
  worktree" without special-casing.

### Config/env pack (spec 014)


- **The repo `.gitignore` ignores `.env` and `.env.*` at every depth.**
  Fixture dotenv files under `tests/fixtures/` must be staged with
  `git add -f` — a plain `git add` silently skips them and CI fails on a
  fresh clone. zsh note: globs do not match dotfiles, so add the fixture
  directory (`git add -f <dir>/`), not `.env*`.
- **vitest collected a fixture named `*.test.ts` as a test suite** ("No
  test suite found") — `include: ["tests/**/*.test.ts"]` reaches into
  `tests/fixtures/`. `vitest.config.ts` now has
  `exclude: ["tests/fixtures/**", ...defaultExclude]` (setting `exclude`
  replaces vitest's defaults, hence the `...defaultExclude` spread).
- **picomatch globstar-vs-root behavior is not assumed in the gitignore
  matcher:** `isCoveredByGitignore` tries the pattern directly and with a
  globstar prefix, so a `**/.env` line covers a root-level `.env`
  regardless of how picomatch treats a bare basename against a
  globstar pattern.
- **A `*/` sequence inside a block comment terminates the comment** — a
  backtick-quoted `` `**/` `` in a doc comment broke esbuild's transform
  (bit spec 014 T1). Write such sequences as prose ("globstar-prefixed")
  inside comments.
- **`RuleContext` now carries `relativePath`** (target-relative posix,
  precomputed in `runner.ts`): path-shape rules need the scan-relative
  path and rules have no other way to get it. Project rules already had
  `project.relativePath()`.

### Agent integration (spec 017)

- **JSON key order in jsonl is construction order:** `JSON.stringify` emits
  object keys in insertion order, and the runner builds every `Diagnostic`
  literal in the interface's declaration order (`id, filePath, line, column,
  rule, category, severity, message, tags`) — `tests/unit/jsonl-contract.test.ts`
  pins this, so reordering the literal breaks the pinned jsonl contract loudly
  instead of silently changing agent-facing bytes.
- **Rule docs are registry-checked:** `checkRuleDocs()`
  (`src/rule-docs/index.ts`, run by `tests/unit/rule-docs.test.ts` in CI)
  fails on a missing doc, a heading/Category/Default-severity mismatch, a
  `docs` path outside `docs/rules/`, or an orphan doc. A new rule is not done
  until its doc passes this gate; scaffold with
  `pnpm build && node dist/scripts/rule-docs.js --scaffold <rule-id>`.
- **Second tsup entries need no wiring:** vitest `globalSetup` calls tsup
  `build` with the same `buildOptions`, so a new entry (e.g.
  `dist/scripts/rule-docs.js`) is built by every test run automatically.

### CI integration (spec 016)

- **`spawnSync` in a vitest test deadlocks any in-worker HTTP server the
  spawned child talks to.** `runCli` blocks the worker's event loop for the
  whole child lifetime, so a `node:http` server living in that same worker
  can accept the child's TCP connection (kernel backlog) but its request
  handler never fires — child waits for a response forever, `spawnSync`
  waits for the child. The fix is `runCliAsync` in `tests/e2e/helpers.ts`
  (promisified `execFile`); use it whenever a test serves HTTP to the CLI.
- **GitHub expressions (`${{ … }}`) inside TS template literals must be
  written `\${{`** — the same interpolation hazard as `${}` — and Biome's
  `noTemplateCurlyInString` bans the `${{` sequence inside plain strings,
  so assertions on rendered expressions belong in template literals with
  the escape, not in quotes.
- **`AddressInfo` is exported from `node:net`, not `node:url`** — the
  natural-looking `import { type AddressInfo } from "node:url"` (next to
  `fileURLToPath`) fails typecheck.

### Runtime probe (spec 018)

- **`node --require` resolves a bare relative path as a module id.** A preload
  path that is neither absolute nor `./`-prefixed goes through the node_modules
  lookup and dies with MODULE_NOT_FOUND (`Cannot find module
  'dist/probe/register.cjs'`). Injection code must always pass an absolute
  path (`runProbe` does; the hook tests derive one from the repo root).
- **`NODE_OPTIONS` accepts double-quoted values**, so the injected directive is
  `--require "<abs path>"` — survives spaces in install paths, appends cleanly
  to an existing value.
- **A default-disposition signal death fires no `'exit'` event**, so the
  preload hook cannot record `probe.detach` for a signal-killed process
  without installing signal handlers (which would change app semantics — §7
  intrusion). `session.json`'s `exit: { signal }` written by the parent is the
  authoritative "how it ended" record.
- **macOS realpath cwd bites every spawned-child path comparison.** The spec
  015 lesson (git toplevel) recurs for `process.cwd()`: a probe (or any child)
  spawned from an `os.tmpdir()` path reports `/private/var/...` while the test
  holds `/var/...`. Canonicalize with `fs.realpathSync` on the *test* side;
  the tool records what the process actually sees.
- **tsup array configs need an array-aware globalSetup.** With the probe hook
  the build became `allBuildOptions: Options[]` (ESM config with `clean: true`
  first, CJS hook config with `clean: false` and
  `outExtension: () => ({ js: ".cjs" })` second); `tests/globalSetup.ts`
  iterates the array. The spec 017 note "second entries need no wiring" holds
  only while `buildOptions` stays a single object.

### Probe collectors (spec 019)

- **Core-module monkey-patching in a `--require` preload IS visible to ESM
  named imports.** Core modules are singletons shared between `require()` and
  `import()`; a preload patches before user code links, so both caller styles
  see the wrapper. Verified live on Node 22.13.1 for
  `import { readFileSync } from "node:fs"` and `import { pbkdf2Sync } from
  "node:crypto"` — the factual basis for spec 019 AC-4.
- **"Native" core functions are mostly JS.** `fs.readFileSync` is a JS
  function from `lib/fs.js`; its `toString()` is source code, not
  `[native code]` — `toString`-based monkey-patch detection is useless for
  node core. Observable patch markers must be explicit properties on the
  wrapper (spec 019 uses a non-enumerable `__backendDoctorProbeWrapped`).
- **`monitorEventLoopDelay` records nothing until `histogram.enable()`.**
  Node 22.13.1/macOS: a freshly created IntervalHistogram reports `count` 0,
  `max` 0 and the constant 511ns floor for every percentile — even under
  load; after `enable()` (returns `true`) values are sane. Window `count`
  can still be 0 in live processes (sampling granularity), so assertions on
  lag data should pin field types, not positivity.
- **`Error.captureStackTrace(holder, wrapperFn)` crops the wrapper's own
  frames** (everything above and including the second argument) — the clean
  way to attribute through a monkey-patch without seeing the patch. The
  captured stack formats lazily: set `Error.prepareStackTrace` to return the
  `CallSite[]`, read `holder.stack`, restore — all inside one synchronous
  block, so a profiler never leaves a global hook patched in the host app.
- **The repo `"type": "module"` reaches into fixture scripts.** Probe
  fixtures that use `require()` must be `.cjs` (`spin.cjs`, `blocking.cjs`);
  a `.js` fixture dies with "require is not defined in ES module scope" —
  the spec 014 vitest-collection lesson's runtime twin.

### HTTP/db/memory collectors (spec 020)

- **A monkey-patched `emit` passthrough must re-join the event name with the
  rest args.** `function (event, ...args)` + a helper doing
  `originalEmit.apply(this, args)` silently turns every host emit into
  `emit(undefined)` — no listener ever runs, `server.listen`'s callback
  never fires, and the app hangs idle with a half-bound socket (no crash,
  no error). Bit spec 020 T5; the self-fetching HTTP fixture caught it in
  the red state. The helper must take `(event, args)` and apply
  `[event, ...args]`.
- **`AsyncLocalStorage.run(store, callback)` invokes the callback without a
  `this`.** Handing `http.Server.prototype.emit` (or any method) directly as
  the callback crashes the host with a TypeError inside `EventEmitter.emit`
  (`this._events` of null). Wrap it: `als.run(store, () =>
  originalEmit.apply(this, [event, ...args]))`. Verified on Node 22.13.1
  (bit spec 020 T5, same session as the bug above).
- **`Server.prototype.emit` wrapping is transparent to node internals** —
  plain `http`/`https` servers (Express/Fastify/Nest ride them) keep
  working; `node:http2` is a separate class and stays uninstrumented.
  Preserving the wrapper's `name` (`Object.defineProperty(…, "name", …)`)
  plus a non-enumerable marker property remains the observable-inertness
  probe (F019's pattern).
- **`Module._load` interception sees two call forms.** A CJS
  `require("@prisma/client")` arrives as the bare specifier; an ESM named
  import of the same CJS package arrives post-resolution as an absolute
  `node_modules/@prisma/client/index.js` path with `parent === undefined`.
  Match both: `id === request || request.includes("node_modules/" + id +
  "/")`. `Module._load` is also absent from @types/node's Module statics —
  cast. Verified live on Node 22.13.1 (spec 020 T6).
- **Idempotency markers for class wraps belong on the class, not the
  exports.** `@prisma/client` copies the generated client's properties (a
  spread), so a wrapped class re-appears on a new exports object without
  any exports-level marker; the class-level marker survives the copy and
  prevents double wrapping (= double counting).
- **Prisma `$use` middleware is the stable counting surface** (works across
  Prisma 5/6): subclass the exported `PrismaClient`, install one middleware
  per instance in the constructor, read only `params.model`/`params.action`
  and wall time. `next(params)` returns a promise — record on settle via
  then/catch re-throw. A client without `$use` → one notice, collector
  stands down (spec 020 AC-7).
- **`PerformanceObserver` holds no event-loop reference** (Node 22.13.1):
  there is no `unref()` and none is needed — the host exits normally with
  the observer attached. GC kinds live on `entry.detail` (`{kind, flags}`);
  the legacy `entry.kind` accessor emits DEP0152, and `detail` is missing
  from @types/node's `PerformanceEntry` — cast. Constants:
  `NODE_PERFORMANCE_GC_MINOR 1 / MAJOR 4 / INCREMENTAL 8 / WEAKCB 16`.
- **A fixture-local `node_modules/` needs `git add -f`.** The root
  `.gitignore`'s `node_modules/` pattern matches at every depth, so
  `tests/fixtures/probe/node_modules/@prisma/client/` silently skips a
  plain `git add` and CI fails on a fresh clone — the spec 014 `.env`
  lesson's exact twin; add the directory with `-f`.

### Combined report (spec 021)

- **`block.call` culprit paths are recorded relative to the probe process's
  cwd when the culprit lives inside it** (`relativeToCwd`,
  `src/probe/hook.ts`); absolute paths pass through unchanged. Consumers of
  `findings.json` must therefore resolve relative `file` values against
  `session.json`'s `session.cwd` — the scan-side `--trace` merge does
  exactly that, and treats a session without a string `cwd` as not
  mergeable (exit 2).
- **findings.json numbers are pre-rounded to 3 decimals at write time**, so
  a JSON parse + `String(number)` round-trip is exact and deterministic for
  building message text — no re-rounding needed on the consumer side.
- **The `Runtime` diagnostic category sat unused in `DIAGNOSTIC_CATEGORIES`
  from spec 001 until F021** — reserved category values are the extension
  point for report-level findings that are deliberately *not* registered
  rules (no config surface, no docs/fixtures obligations under
  constitution §3). Config keeps rejecting such ids as unknown, which is
  the documented contract, not an oversight.
- **Never mutate shared `dist/` artifacts inside a test.** The spec 018 e2e
  "missing hook preload" test renamed `dist/probe/register.cjs` to
  `.hidden` for its duration and restored it afterwards — a ~200 ms window
  in which every *other* parallel vitest worker spawning the hook (e2e
  probes, hook integration children) fails with `Cannot find module` or
  "probe hook not found". The race was latent since F018 (tiny window,
  few spawning tests) and started firing almost every full-suite run once
  F021 added three more process-spawning e2e files. Fix pattern: preflight
  logic lives in a unit-testable function (`hookPreflightError`); tests
  never hide shared build artifacts — point them at temp paths instead.
