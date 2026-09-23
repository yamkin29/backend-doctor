# backend-doctor

A deterministic static analyzer for Node.js and NestJS backends. It reads your
TypeScript — controllers, providers, services, repositories, Prisma queries,
configuration — and reports what will bite in production: floating promises,
event-loop blocking calls, security holes, broken dependency wiring,
architecture drift.

- **Deterministic** — the same tree produces byte-identical findings, every
  time, so ids can be referenced in code review and CI conversations.
- **Precision over recall** — every rule is gated on an eval corpus whose
  clean application produces **zero** findings; a rule that cries wolf gets
  fixed or demoted before it ships.
- **Zero intrusion** — no changes to your code, build config or runtime. No
  network access, no telemetry: scans, traces and reports stay on your disk.

## Quick start

```sh
npx backend-doctor-cli@latest scan
```

That scans the current directory and prints a pretty report. Exit code `0`
means clean, `1` means findings at `error` severity, `2` means a usage or
configuration problem (bad flag, unreadable config) — not a crash.

For machine-readable output:

```sh
npx backend-doctor-cli@latest scan --format json    # one schemaVersion-1 document
npx backend-doctor-cli@latest scan --format jsonl   # one JSON object per finding
```

Useful scan flags:

```sh
--scope changed        # only files changed in git (vs --base <ref>, default HEAD)
--scope lines          # only diagnostics inside changed hunks
--scope files --file <path> [--file <path> …]
--ignore "<glob>"      # exclude files, repeatable
--config <path>        # load exactly this config, skip discovery
--trace <dir>          # merge runtime findings from a probe session
```

## Configuration

`backend-doctor.config.ts` (or `.json`, or a `backendDoctor` key in
`package.json`) is discovered by walking up to the nearest `.git`:

```ts
/** Severities: "error" | "warn" | "off". */
export default {
	rules: {
		"backend-doctor/no-floating-promises": "error",
		"backend-doctor/unused-file": "off",
	},
	categories: {
		Security: "error",
	},
	ignore: {
		files: ["**/*.spec.ts"],
		rules: [],
	},
};
```

Create a starter file with `npx backend-doctor-cli@latest init`. CLI flags
override config. Inspect what actually resolved with
`npx backend-doctor-cli@latest scan --dump-config`.

## Rules

Rules cover eight categories — Bugs, Correctness, Performance, Security,
Architecture, Maintainability, Configuration, Runtime — across async
correctness, event-loop blocking, Node security, Nest DI and layering, DTO
shape, Prisma usage, project-graph hygiene and config/env handling.

```sh
npx backend-doctor-cli@latest rules list          # every registered rule
npx backend-doctor-cli@latest rules explain backend-doctor/no-eval
```

Every rule has a markdown doc under `docs/rules/backend-doctor/<rule>.md` —
the problem it flags, a bad and a good example, and its config key. The docs
ship inside the npm package, so the path printed by `rules explain` resolves
from the installed package as well as from the repository. Nest- and
Prisma-specific rules activate automatically when those frameworks are
detected in the scanned project.

## CI (GitHub Actions)

```sh
npx backend-doctor-cli@latest ci install
```

writes a workflow that scans pull requests and posts a sticky PR comment,
inline review comments and a commit status via `ci report`. Blocking is opt-in
(`blocking: none` by default — findings are reported, not failed).

## Runtime probe

Static analysis misses what only shows up while the process runs. The probe
starts your app instrumented — no code changes — and records event-loop lags,
blocking calls with file:line attribution, HTTP endpoint latencies, database
query counts and memory/GC signals:

```sh
npx backend-doctor-cli@latest probe -- npm start
npx backend-doctor-cli@latest probe --duration 60 -- node dist/main.js
```

Sessions land in `./.backend-doctor/probe/`. Merge them into a static scan:

```sh
npx backend-doctor-cli@latest scan --trace .backend-doctor/probe/<session>
```

Traces contain URLs and filesystem paths — they are treated as sensitive and
are never sent anywhere.

## For coding agents

The package ships an agent skill — a small instruction file that teaches
coding agents supporting the Agent Skills format (Claude Code and others) to
run a scoped scan after backend edits and read the findings correctly.

Install the skill into your agent's skills directory:

```sh
npm install --no-save backend-doctor-cli
mkdir -p ~/.claude/skills
cp -r node_modules/backend-doctor-cli/skills/backend-doctor ~/.claude/skills/
```

The example paths are Claude Code's; other agents use an equivalent skills
folder — check your agent's documentation. Or run an ad-hoc scan without
installing the skill:

```sh
npx backend-doctor-cli@latest scan --scope changed --format jsonl
```

Each jsonl line is one finding with a deterministic `id` (stable across runs),
`filePath`/`line`/`column`, the `rule` id, `category`, `severity`, `message`
and `tags` — empty output means clean. Agents can read the offending rule's
doc from `docs/rules/backend-doctor/` in the installed package.

## Development

```sh
pnpm install
pnpm test        # vitest; builds the CLI first
pnpm lint        # biome
pnpm build       # tsup → dist/
pnpm docs:rules  # rule-docs ↔ registry drift check
```

## License

[MIT](./LICENSE)
