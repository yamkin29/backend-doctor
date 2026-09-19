# backend-doctor/no-async-foreach-callback

Flags `X.forEach(async …)` — `forEach` ignores the promise the callback
returns.

- **Category:** Bugs
- **Default severity:** `warn`

## Problem

`Array.forEach` does not await its callback: the loop "finishes" before any
of the async work does, iteration order no longer matches completion order,
and every rejection becomes an unhandled promise rejection. Code that looks
sequential runs concurrently and half-done.

## Bad

```ts
// ❌ the promise returned by the callback is dropped
items.forEach(async (item) => {
	await save(item);
});

// ❌ same with an async function expression
items.forEach(async function (item) {
	await save(item);
});
```

## Good

```ts
// ✅ sequential processing when order matters
for (const item of items) {
	await save(item);
}

// ✅ concurrent processing with failure propagation
await Promise.all(items.map((item) => save(item)));
```

## Scope notes (precision over recall, constitution §2)

- Any receiver matches (`Array`, `Map`, `Set` — the rule has no type info),
  because the bug shape is identical.
- Sync callbacks, async callbacks passed to `.map`/`.filter` (the
  `Promise.all` pattern) and `for…of` with `await` are not flagged.
- Callbacks referenced by identifier (`items.forEach(handler)` where
  `handler` is async) are a documented recall hole — resolving them needs
  the same-file binding analysis generalized beyond call sites.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"backend-doctor/no-async-foreach-callback": "error",
		// or silence it deliberately:
		// "backend-doctor/no-async-foreach-callback": "off",
	},
});
```
