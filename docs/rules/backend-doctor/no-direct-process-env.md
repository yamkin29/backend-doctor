# backend-doctor/no-direct-process-env

Flags direct `process.env` reads outside config- and test-shaped files.

- **Category:** Configuration
- **Default severity:** `warn`

## Problem

Every `process.env` read in business code is a hidden configuration
dependency: defaults, naming and validation end up scattered across
services and handlers, so there is no single place where configuration
lives. Centralizing reads in a config module makes defaults explicit,
lets one schema validate the whole environment, and keeps tests able to
swap configuration in one place.

## Detection

A finding is the access node of either exact shape:

- `process.env.<Identifier>` (member access, including `?.`);
- `process.env["<StringLiteral>"]` (string-keyed element access).

The access anchor is the node whose immediate base is exactly the
`process.env` chain, so a longer chain (`process.env.FOO.BAR`) yields one
finding, not two. A file is exempt when its target-relative path is:

- **config-shaped** — any directory segment (lowercased) is `config`,
  `configs`, `configuration`, `configurations`, `env`, `environments` or
  `settings`, or the basename (extension stripped) contains `config`,
  `env` or `settings`;
- **test-shaped** — any directory segment is `test`, `tests`,
  `__tests__` or `e2e`, or the basename ends in `.test`/`.spec` (env
  setup in tests is idiomatic — spec 014 resolution 2).

## Bad

```ts
// ❌ configuration dependency hidden in a service
export class UsersService {
	getTimeout(): number {
		return Number(process.env.REQUEST_TIMEOUT);
	}
}
```

## Good

```ts
// ✅ src/config/settings.ts — the only place that reads the environment
export const settings = {
	requestTimeout: Number(process.env.REQUEST_TIMEOUT ?? 5000),
};
```

## Scope notes (precision over recall, constitution §2)

Not flagged (documented recall holes):

- whole-env reads — `const vars = process.env`, destructuring
  (`const { PORT } = process.env`);
- element access with a dynamic key (`process.env[key]`);
- other roots — `globalThis.process.env.X`, `ctx.process.env.X`,
  parenthesized bases (`(process.env).X`), `process["env"]["X"]`;
- files whose basename contains `env` without meaning the environment
  (`envelope.ts`, `revenue.ts` are exempt by the basename heuristic).

Hand-written shadowing of `process` is not detected. Type-level
references (e.g. `interface ProcessEnv` augmentation) contain no access
expression and are out of reach by construction.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Treat scattered env reads as build-breakers:
		"backend-doctor/no-direct-process-env": "error",
		// or silence it deliberately:
		// "backend-doctor/no-direct-process-env": "off",
	},
});
```
