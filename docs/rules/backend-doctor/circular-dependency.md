# backend-doctor/circular-dependency

Reports every file participating in an import cycle — chains like
`a.ts -> b.ts -> c.ts -> a.ts` that loop back on themselves.

- **Category:** Architecture
- **Default severity:** `warn`

## Problem

In a cycle, no file is "below" another: each module's initialization can
run before the module it depends on has finished executing, so constants
and class extends can see `undefined`, mocks get installed in the wrong
order, and bundlers cannot tree-shake any member. Cycles also lock the
architecture in place — every refactoring has to thread through the loop.

## Bad

```ts
// a.ts
import { serveB } from "./b";
export function serveA() { return `a<-${serveB()}`; }

// b.ts
import { serveA } from "./a"; // ❌ loops back
export function serveB() { return `b<-${serveA()}`; }
```

## Good

```ts
// shared.ts — the piece both sides need moves below the cycle
export function serve(name: string) { return `served:${name}`; }

// a.ts
import { serve } from "./shared";
// b.ts
import { serve } from "./shared";
```

## Scope notes (precision over recall, constitution §2)

- Edges are the analyzed files' literal import specifiers (static imports,
  `require`, dynamic `import()`), resolved to sibling files including the
  TypeScript `.js`→`.ts` / `.mjs`→`.mts` / `.cjs`→`.cts` and `/index`
  mappings. Bare package specifiers are not graph edges.
- One diagnostic per cycle member, each carrying the same canonical chain
  (smallest member first). Re-exports (`export … from`) and computed
  specifiers (`` import(`./x/${name}`) ``) are not edges today — a
  documented recall hole.
- Framework-free: runs on every full scan.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/circular-dependency": "error",
		// or silence it deliberately:
		// "backend-doctor/circular-dependency": "off",
	},
});
```
