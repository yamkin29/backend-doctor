# backend-doctor/unused-file

Reports files that no entry point reaches through imports — dead code that
still gets compiled, type-checked and maintained.

- **Category:** Maintainability
- **Default severity:** `warn`

## Problem

A file nothing can reach is a liability disguised as a feature: it shows up
in search, its imports and dependencies still resolve, its tests (if any)
still pass — and none of it ever runs. Dead files mislead readers about
what the system actually does, keep stale dependencies alive, and rot
until someone finally deletes them by hand.

## Bad

```ts
// src/orphan.ts — no entry point reaches this
export function oldHandler() {
	return "replaced months ago";
}
```

## Good

```text
src/main.ts → src/app.module.ts → src/users/users.module.ts → …
```

Either delete `src/orphan.ts` or wire it in from a module an entry point
reaches.

## Scope notes (precision over recall, constitution §2)

- Entry files: `package.json` `main`/`bin` targets plus the conventional
  `src/main.ts`, `src/index.ts`, `main.ts`, `index.ts`. When the project
  has none of these, the rule stays silent — reachability proves nothing
  without roots (libraries with unusual bootstraps).
- Reachability follows the same import edges as `circular-dependency`
  (literal specifiers, `.js`→`.ts` and `/index` mappings). A file imported
  only by another unreachable file is still unreachable — the whole
  cluster is reported.
- Framework-free: runs on every full scan.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/unused-file": "error",
		// or silence it deliberately:
		// "backend-doctor/unused-file": "off",
	},
});
```
