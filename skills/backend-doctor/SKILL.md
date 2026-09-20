---
name: backend-doctor
description: Deterministic static analysis for Node.js and NestJS backends. Use after editing backend TypeScript — routes, controllers, services, repositories, Prisma queries, config — to catch async bugs, security issues, event-loop blocking and architecture problems before committing.
---

# backend-doctor

`backend-doctor` is a deterministic static analyzer for Node.js/NestJS
backends: the same tree always produces byte-identical findings. It reads the
code — no network access, no telemetry, no changes to your files.

## When to run

Run one pass after you edit or create backend TypeScript files (API routes,
controllers, providers, services, repositories, data access, configuration),
before you call the change done.

## How to run

After edits — scan only what changed:

```sh
npx backend-doctor@latest scan --scope changed --format jsonl
```

For a whole-repository audit (onboarding, pre-refactor inventory):

```sh
npx backend-doctor@latest scan --format jsonl
```

Notes:

- `--scope changed` requires a git repository; it diffs against `HEAD` by
  default, pass `--base <ref>` to compare against another ref.
- Exit code `1` still means the scan ran and produced findings at error
  severity — read the output, it is not a crash.
- If the npm package is not published yet, run a repository-local build:
  `pnpm build && node dist/bin/backend-doctor.js scan <path> --format jsonl`.

## Reading findings

With `--format jsonl` the scan prints one JSON object per finding and nothing
else — empty output means the scanned code is clean. Fields:

- `id` — deterministic finding id, stable across runs; safe to reference in
  the conversation.
- `filePath`, `line`, `column` — where the finding is.
- `rule` — rule id, e.g. `backend-doctor/no-eval`.
- `category`, `severity` — classification; `severity` is `warn` or `error`.
- `message` — what is wrong.
- `tags` — extra classification. The tag `internal` means a rule crashed
  while scanning; report it as a tool problem, do not "fix" user code for it.

Exit codes: `0` clean, `1` findings with `error` severity, `2` usage or
configuration problem (check flags and config; do not retry blindly).

## Acting on findings

1. Fix the code the finding points at — the message and the rule doc describe
   what is expected. Do not silence a rule to make a finding disappear:
   silence only confirmed false positives, and prefer narrowing the flagged
   code over disabling the rule.
2. For bad/good examples, scope notes and configuration of a rule, read its
   doc at `docs/rules/backend-doctor/<rule>.md` in the backend-doctor
   repository (https://github.com/yamkin29/Node-doctor), or run:

```sh
npx backend-doctor@latest rules explain backend-doctor/no-eval
```

3. To browse everything the tool checks, run:

```sh
npx backend-doctor@latest rules list
```

## Silencing a rule (deliberately)

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// confirmed false positive only:
		"backend-doctor/no-eval": "off",
	},
});
```
