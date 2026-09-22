# backend-doctor/unused-export

Reports exported symbols that no other file imports — public API nobody
uses.

- **Category:** Maintainability
- **Default severity:** `warn`

## Problem

Every unused export is a piece of the codebase pretending to have
consumers: refactoring has to keep it compiling, reviewers have to keep
reading it, and the file's real interface disappears behind a wall of
drifted `export` keywords. Exports usually die quietly — the last caller
was deleted and nobody removed the keyword.

## Bad

```ts
// thing.ts
export function used(): string { return "used"; }

// ❌ the last caller was deleted months ago
export function abandoned(): string { return "abandoned"; }

// ❌ constructed nowhere
export class Forgotten { value = 1; }
```

## Good

```ts
// ✅ the keyword comes off, the helper stays private
function abandoned(): string { return "abandoned"; }
// …or delete the code outright.
```

## Scope notes (precision over recall, constitution §2)

- Usage is import-based: a named import uses that name, a default import
  uses `default`, and namespace imports, side-effect imports, `require`,
  dynamic `import()` and re-exports (`export { x } from`, `export * from`)
  use *every* export of the target.
- Entry files (`package.json` `main`/`bin`, conventional
  `src/main.ts`/`src/index.ts`) are exempt — their exports are the public
  surface. When the project has no entry files at all, the rule stays
  silent (the same precision gate as `unused-file`).
- Computed usage the engine cannot see — string-based DI tokens,
  metaprogramming — is a documented recall hole. Framework-free.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/unused-export": "error",
		// or silence it deliberately:
		// "backend-doctor/unused-export": "off",
	},
});
```
