# backend-doctor/no-unsafe-merge

Flags merges of request data into objects — the prototype-pollution write
shape.

- **Category:** Security
- **Default severity:** `warn`

## Problem

`Object.assign(target, req.body)` and `_.merge(config, req.body)` copy every
own key of the request payload — including `__proto__` and `constructor`.
A `__proto__` key flips the target's prototype or, in deep merges, poisons
`Object.prototype` for the whole process: every subsequent object literal
inherits the attacker's properties. The fix is a prototype-safe merge or
rejecting those keys before merging.

## Bad

```ts
// ❌ a body of {"__proto__": {"isAdmin": true}} taints every object after it
export function updateSettings(req: { body: Record<string, unknown> }): Settings {
	return Object.assign(currentSettings, req.body);
}
```

## Good

```ts
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// ✅ drop the dangerous keys before merging
export function updateSettings(req: { body: Record<string, unknown> }): Settings {
	const patch = Object.fromEntries(
		Object.entries(req.body).filter(([key]) => !FORBIDDEN_KEYS.has(key)),
	);
	return Object.assign(currentSettings, patch);
}
```

## Scope notes (precision over recall, constitution §2)

Flagged (any argument carrying `req`/`request`-rooted input, spec 007 open
question 3): `Object.assign`; `merge`/`mergeWith`/`defaultsDeep`/
`deepmerge` as bare identifiers (shadow-checked, no module gate —
`Object.assign` is a global and an unshadowed bare `merge` is lodash-
shaped anyway); the same names on receivers `_` and `lodash`. Receivers
like `map.merge` or a user's `opts.assign` are treated as trusted code.

Not flagged (documented recall holes):

- spread syntax (`{ ...req.body }`) — not a call; it carries the same
  `__proto__` risk for plain objects and deserves its own rule if the eval
  corpus (F022) shows demand;
- request input that reached the merge through an intermediate variable;
- custom deep-merge helpers and recursive merges;
- `lodash.assign`, `_.defaults` and other non-listed lodash writers.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Prototype pollution is rarely intended — escalate after triage:
		"backend-doctor/no-unsafe-merge": "error",
		// or silence it deliberately:
		// "backend-doctor/no-unsafe-merge": "off",
	},
});
```
