# backend-doctor/no-new-func

Flags `new Function(…)`.

- **Category:** Security
- **Default severity:** `warn`

## Problem

`new Function(body)` compiles an arbitrary string into a function at runtime —
semantically a lazy `eval`. The string is rarely reviewable and typically ends
up containing interpolated user or environment input, which makes it a code
injection vector, and the construct hides its dependencies from static analysis.

## Bad

```ts
// ❌ body built at runtime from untrusted pieces
const compute = new Function("a", "b", `return ${expression}`);
```

## Good

```ts
// ✅ explicit function, reviewable and type-checked
const compute = (a: number, b: number) => a + b;
```

## Scope notes (precision over recall, constitution §2)

- `new MyFunction()` is **not** flagged — only the exact identifier `Function`
  is treated as the dynamic evaluator.
- `new globalThis.Function(…)` is **not** flagged yet; the member-expression
  form can be added to the F007 security pack if the eval corpus demands it.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/no-new-func": "error",
	},
});
```
