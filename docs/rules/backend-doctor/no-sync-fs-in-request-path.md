# backend-doctor/no-sync-fs-in-request-path

Flags synchronous `node:fs` calls made inside function bodies — blocking
I/O on the event loop.

- **Category:** Performance
- **Default severity:** `warn`

## Problem

Node.js runs your code on a single event loop. A synchronous fs call
(`readFileSync`, `existsSync`, …) blocks that loop for the whole duration of
the I/O — while it runs, the process accepts no connections, answers no
requests and serves no responses. In a request path this multiplies into
every concurrent user waiting on one file read; in production it shows up as
mystery p99 spikes. Startup work at module top level is different: nothing
is being served yet, so blocking once during boot is idiomatic — which is
why this rule exempts module top level.

The rule is a **heuristic**: without a call graph it cannot know which
functions actually run per request, so any call inside a function body
counts as potential request path (see Scope notes).

## Bad

```ts
import fs from "node:fs";

// ❌ blocking read inside a handler-called function
export function loadTemplate(name: string): string {
	return fs.readFileSync(`templates/${name}.html`, "utf8");
}

// ❌ named-import form — flagged just the same
import { statSync } from "node:fs";
export function isCached(path: string): boolean {
	return statSync(path).mtimeMs > cacheTime;
}
```

## Good

```ts
import { readFile, stat } from "node:fs/promises";

// ✅ promise API — the loop serves other requests while the I/O runs
export async function loadTemplate(name: string): Promise<string> {
	return readFile(`templates/${name}.html`, "utf8");
}

// ✅ one-time startup read, at module top level
export const config = JSON.parse(readFileSafe("config.json"));
```

## Scope notes (precision over recall, constitution §2)

Detected callee forms: a property access `<recv>.<syncMethod>(…)` on any
receiver (default/namespace imports produce different local names), and a
bare identifier `<syncMethod>(…)` not shadowed by a same-file
function/variable declaration. `this.<syncMethod>()` calls on a class that
declares the member itself are treated as user code, not fs. The file must
reference one of the fs module specifiers (`fs`, `node:fs`, `fs/promises`,
`node:fs/promises`) — static import, `require` or dynamic `import`; the
promise API (`fs.promises.*`) cannot match because none of its methods are
`*Sync`-suffixed.

Not flagged (documented recall holes):

- calls at module top level — startup blocking is idiomatic;
- aliased named imports (`import { readFileSync as rf }`) — the local name
  is unresolvable without import-binding analysis;
- files that never import an fs module — a same-named method on an
  unrelated object is not fs;
- `fs.createReadStream`-style streaming APIs (not `*Sync`-suffixed).

Handler attribution (which functions are actually route handlers) lands with
the Nest app model (F008), graph rules (F013) and runtime attribution
(F019); until then every function body counts as potential request path.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"backend-doctor/no-sync-fs-in-request-path": "error",
		// or silence it deliberately:
		// "backend-doctor/no-sync-fs-in-request-path": "off",
	},
});
```
