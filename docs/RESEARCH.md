# RESEARCH — implementation notes

Non-obvious constraints worth preserving during maintenance. Read the section
relevant to your task; verify dependency-specific behavior when upgrading.
Add a note only when it explains a recurring risk, with a code/test reference.
Keep setup commands in [CONTRIBUTING](../CONTRIBUTING.md), product behavior in
[README](../README.md), and feature decisions in [specs](specs/).

React Doctor inspired the CLI experience and integrations. The local design
and its differences are recorded in [spec 028](specs/028-interactive-console/spec.md);
this file does not track another product's current features or rule counts.

## Packaging and configuration

- **Use the same build configuration in tests and releases.** Programmatic
  tsup builds need `config: false`; otherwise tsup reloads the array config and
  merges it into each build, producing unwanted ESM/CJS variants. Build the ESM
  entries first, then the CJS probe hook without cleaning the earlier output.
  See [build config](../tsup.config.ts) and [test setup](../tests/globalSetup.ts).
- **Test the package as a consumer.** Generate declarations only for the public
  `index` entry. Including the console in declaration generation can create a
  shared type chunk omitted by the package allowlist. A tarball file-list check
  alone misses this: [package tests](../tests/e2e/pack.test.ts) also typecheck
  `defineConfig` from exactly the packed files with `skipLibCheck` disabled.
- **Keep runtime loaders/assets external.** jiti needs its loader machinery;
  Ink/React need their installed dependencies, including Yoga assets. The console
  has a separate entry loaded only after terminal activation. See
  [build config](../tsup.config.ts) and [console loading](../src/cli/console-mode.ts).
- **jiti's virtual default is not a real default export.** Check own property
  names before using `mod.default`; use `in` / `Symbol.toStringTag` to identify
  ESM wrappers. JSON serialization can hide non-enumerable interop markers.
  See [config loader](../src/config/load.ts) and [tests](../tests/unit/config/load.test.ts).

## Parser and import graph

- **Keep AST access behind the parser boundary.** `Node` must be a runtime
  value for its guards; a type-only import removes it. Traversal callbacks must
  return `undefined` or the documented control value, never an incidental truthy
  result such as `array.push(...)`. See [boundary](../src/engine/parser/types.ts).
- **Verify API names against the installed ts-morph version.** For example,
  catch clauses use `getBlock()` and while/do loops use `getExpression()`;
  `getCondition()` belongs to for loops. Real examples live in
  [catch handling](../src/rules/errors/no-empty-catch.ts) and
  [loop helpers](../src/rules/blocking/loops.ts).
- **Positions follow AST nodes.** Decorated declarations start at the leading
  decorator; variable declarations start at the declarator name. Derive fixture
  coordinates from actual parser output. See
  [Nest model tests](../tests/unit/framework/nest-model.test.ts).
- **Re-exports and supported aliases are graph edges.** The adapter collects
  static imports/re-exports and string-literal `require`/dynamic imports; computed
  import paths remain outside that collection. TypeScript resolves supported
  `baseUrl`/`paths` aliases, including inherited config origins. See
  [adapter](../src/engine/parser/ts-morph-adapter.ts) and
  [regressions](../tests/integration/audit-remediation.test.ts).
- **Dotted Nest names are not necessarily extensions.** `./app.module` must
  resolve to `app.module.ts`. Structural resolution uses known extensions and
  `.js` → `.ts`, `.mjs` → `.mts`, `.cjs` → `.cts` swaps. Unresolved internal
  modules or targets outside the analyzed set make the graph incomplete.
  See [graph construction](../src/engine/imports.ts).

## Diff scope and coverage

- **Normalize path bases before filtering.** Git and Node may expose different
  spellings of macOS temporary paths (`/var` versus `/private/var`). Canonicalize
  paths for comparison, then preserve the engine's spelling in results. Run
  scope-related Git commands from the repository root: subcommands differ in
  how they interpret/report paths from a subdirectory. See
  [scope resolver](../src/scope/resolve.ts) and [tests](../tests/e2e/diff-scope.test.ts).
- **Parse zero-context hunk headers, not file headers.** Use `-U0` with
  `--no-ext-diff --no-textconv --no-color`; paths with spaces and user Git
  settings must not change parsing or execute diff helpers. An unborn HEAD
  differs from an invalid base or unrelated histories. See [diff code](../src/scope/diff.ts).
- **Full scope does not prove full coverage.** `complete` describes scan scope;
  also inspect `analyzedFileCount` and `skippedChecks`. Partial scans skip
  project rules; incomplete graphs skip unsafe unused-code conclusions. Empty
  JSONL only means no diagnostics were emitted. See [audit tests](../tests/e2e/audit-remediation.test.ts).

## Tests and fixtures

- **Baseline identity differs from report identity.** Diagnostic IDs include
  current source positions. Introduced scans match parser-derived source anchors
  with one-to-one occurrence consumption and unchanged-line preference instead.
  Walk parsed syntax for anchors: rescanning text without parser context can
  mistake regex character classes for comments. See
  [matching regressions](../tests/unit/scope/introduced.test.ts).
- **Read baseline Git objects without checking out code.** Historical config is
  never executed; symlinks are not followed. Canonicalize current paths before
  deriving snapshot-relative paths, while preserving report spelling. Empty
  baselines must include indexed files as well as `ls-files --others`. See
  [introduced scan integration](../tests/integration/introduced-scan.test.ts) and
  [CLI coverage](../tests/e2e/introduced.test.ts).

- **Never rename or remove shared `dist/` artifacts during tests.** Parallel
  workers spawn the same built CLI/hook. Use temporary missing paths to test
  preflight failures. See [probe tests](../tests/e2e/probe.test.ts).
- **Use asynchronous child execution when a test serves HTTP to the CLI.**
  `spawnSync` blocks the same worker that must answer the request, causing a
  deadlock. See [CLI helpers](../tests/e2e/helpers.ts).
- **Color detection differs between libraries.** The suite sets `NO_COLOR`
  before module initialization for stable pretty output; the Ink console also
  needs an explicit style guard. Test `NO_COLOR` together with `FORCE_COLOR`,
  not just a pipe. See [test config](../vitest.config.ts) and
  [console regressions](../tests/e2e/interactive-flags.test.ts).
- **Fixture files are data.** Vitest excludes fixture trees. The root
  [.gitignore](../.gitignore) allows intentional dotenv/mock Prisma fixtures,
  but `no-committed-env/valid/.gitignore` deliberately ignores dotenv files
  as test input; new files there still need `git add -f <file>`.

## Interactive console

- **Keep rendering separate from analysis.** Terminal activation must preserve
  JSON, JSONL, piped output and verdicts. Real terminal checks complement stream
  tests; restore raw mode, cursor and session listeners on exit/error/signals.
  cli-cursor installs a process-lifetime hook, so warm it before measuring
  per-session listener leaks. See [session tests](../tests/integration/console-session.test.ts).
- **Runtime findings need separate guidance.** Their report-level IDs are not
  registered static rules. Console docs/prompt handling must account for this.
  A local score is unavailable with partial scope, skipped checks or no analyzed
  files. See [console model](../src/cli/console/model.ts) and
  [content](../src/cli/console/content.ts).
- **Clipboard behavior needs native checks.** Adapter tests cover platform
  command selection and failures; a live clipboard smoke should preserve and
  restore existing clipboard content. Usage and keyboard controls are in
  [README](../README.md).

## Runtime instrumentation and trace merging

- **Preload paths must be absolute and quoted in `NODE_OPTIONS`.** Keep the
  hook CommonJS for the supported preload path. Preserve existing options and
  application behavior. Default signal termination need not emit a process
  `exit` event: the parent's `session.json` records the authoritative outcome.
  See [runner](../src/probe/runner.ts) and [options](../src/probe/node-options.ts).
- **Preserve receivers, arguments and global hooks.** HTTP emit wrappers must
  forward the event name and run the original method with its receiver inside
  `AsyncLocalStorage.run`. Stack capture must restore `Error.prepareStackTrace`
  synchronously. Core-module patches need both CJS and ESM tests. See
  [hook](../src/probe/hook.ts) and [hook tests](../tests/unit/probe/hook.test.ts).
- **Enable event-loop histograms; allow empty windows.** A live sampling window
  may contain no measurements. Test structure rather than requiring positive
  lag in every run. See [collector tests](../tests/unit/probe/hook.test.ts).
- **Resolve relative culprit paths against the recorded session cwd.** Validate
  trace versions and `session.cwd` before merging. Runtime findings belong to
  the `Runtime` category but are not configurable registry rules. See
  [trace loading](../src/runtime/load.ts) and [merging](../src/runtime/merge.ts).

## Prisma runtime compatibility

- **Use the [compatibility matrix](PRISMA_COMPATIBILITY.md) as the coverage reference.**
  Real-client evidence is separate from synthetic collector tests; reproduce it
  with the [compatibility harness](../tests/compat/README.md).
- **Preserve the native client when observing queries.** The query extension
  hides native `$on`; returning it directly breaks subscriptions. The forwarding
  Proxy uses the native target for `$on` and delegates other reads to the
  extension, preserving subclass/private-field behavior. Mark wrapped classes
  rather than export objects, which Prisma can copy. See
  [hook](../src/probe/hook.ts) and [real-client tests](../tests/compat/prisma6/runtime.test.ts).
- **Zero observed queries do not establish compatibility.** Custom generated
  client paths can bypass interception. The Prisma 7 standard generator loader
  remains a separate [draft spec 027](specs/027-prisma-generated-client-loader/spec.md).
