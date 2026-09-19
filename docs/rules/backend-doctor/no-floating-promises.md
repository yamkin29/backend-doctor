# backend-doctor/no-floating-promises

Flags statement-level calls that return a promise nobody handles — the
call finishes, but nobody waits for it and its rejection is lost.

- **Category:** Correctness
- **Default severity:** `warn`

## Problem

A promise created and never awaited or chained silently swallows its own
rejection: the operation fails, nothing notices, and the request keeps
running with half-finished state. In Node.js this is the classic source of
"it works until it doesn't" bugs — a swallowed DB error, a missing reply, a
fire-and-forget write that never lands. This rule is a **heuristic**: it
does not use the typechecker (a type-aware version is future work, see
spec 005 non-goals).

## Bad

```ts
// ❌ async function called without await — rejection is lost
async function loadUser(): Promise<User> {}
loadUser();

// ❌ known promise-returning global
fetch("https://api.example.com/flush");

// ❌ async method of the same class, fired and forgotten
class Users {
	async refresh(): Promise<void> {}
	poll(): void {
		this.refresh();
	}
}
```

## Good

```ts
// ✅ await the call
async function main(): Promise<void> {
	await loadUser();
}

// ✅ attach a handler
fetch("https://api.example.com/flush").catch((error: unknown) => {
	logger.error("flush failed", error);
});

// ✅ mark intentional fire-and-forget with the void operator
void loadUser();
```

## Scope notes (precision over recall, constitution §2)

Detected callee forms: an identifier bound in the same file to an `async`
function declaration or an async arrow/function expression assigned to a
variable (nearest scope wins), `this.<asyncMethod>()` on the enclosing
class, and a bare `fetch` not shadowed by a same-file binding.

Not flagged (documented recall holes):

- chained forms such as `load().then(…)` — the callee is no longer a bare
  identifier; revisit after the eval corpus (F022) if it matters;
- cross-file calls: imported async functions and object-literal methods are
  not resolved without type information;
- a result that is assigned, returned or yielded (`const p = load()`) — the
  promise is at least captured; full liveness tracking is out of scope;
- constructor bodies: `no-async-constructor-work` owns them, so one
  violation produces exactly one diagnostic.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"backend-doctor/no-floating-promises": "error",
		// or silence it deliberately:
		// "backend-doctor/no-floating-promises": "off",
	},
});
```
