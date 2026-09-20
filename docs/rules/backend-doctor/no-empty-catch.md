# backend-doctor/no-empty-catch

Reports `catch` blocks that swallow an error without a trace — no handling,
no rethrow, not even a comment saying why.

- **Category:** Bugs
- **Default severity:** `warn`

## Problem

An empty `catch` turns every failure into silence: the operation silently did
not happen, the state silently diverged from what the code believes, and the
only witness — the error object — is discarded. These blocks rot fastest in
exactly the places that fail rarely (cache eviction, cleanup, telemetry),
which makes them the hardest bugs to reproduce later. Handle the error, wrap
it into a domain error, rethrow it — or, if ignoring it is genuinely correct,
write the reason as a comment inside the block.

## Bad

```ts
// ❌ the error vanishes without a trace
try {
	cache.delete(key);
} catch {}
```

## Good

```ts
// ✅ handle it
try {
	cache.delete(key);
} catch (error) {
	throw new Error(`cache prune failed for ${key}`, { cause: error });
}

// ✅ or document the deliberate ignore — a comment inside the block
//    keeps this rule quiet
try {
	cache.delete(key);
} catch {
	// deletion is best-effort; a failed prune is not worth surfacing
}
```

## Scope notes (precision over recall, constitution §2)

- Fires only when the block holds zero statements **and** no comment; a
  comment-only body is documented intent and stays silent (the ESLint
  `no-empty` precedent).
- A comment *after* the closing brace (`} catch {} // best-effort`) does not
  silence the rule — move it inside the braces.
- `finally` blocks and `Promise.catch(() => {})` are not flagged (PLAN scope:
  `empty-catch`); other swallow shapes are future work.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/no-empty-catch": "error",
		// or silence it deliberately:
		// "backend-doctor/no-empty-catch": "off",
	},
});
```
