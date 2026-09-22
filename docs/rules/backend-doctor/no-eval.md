# backend-doctor/no-eval

Flags `eval()` — the direct call, the comma-indirect `(0, eval)(…)` form and
`globalThis.eval(…)`.

- **Category:** Security
- **Default severity:** `warn`

## Problem

`eval` executes arbitrary code from a string at runtime. In backend services it
typically appears when someone parses JSON-ish payloads or "dynamic" formulas by
hand, and it turns any input that reaches the string into a code-injection
vector. It also defeats bundlers, minifiers and static analysis.

## Bad

```ts
// ❌ direct eval
const value = eval(`(${input})`);

// ❌ indirect eval — same semantics as a direct call
const indirect = (0, eval)("process.env");

// ❌ globalThis form
globalThis.eval("doSomething()");
```

## Good

```ts
// ✅ parse data with JSON.parse
const value: unknown = JSON.parse(input);

// ✅ express the "dynamic formula" as an explicit, reviewed branch
const result = operators[operatorName](left, right);
```

## Scope notes (precision over recall, constitution §2)

- `evaluator("…")` is **not** flagged — an identifier merely containing the
  substring `eval` is an ordinary call.
- Aliased eval (`const e = eval; e("…")`, destructured or re-exported aliases)
  is **not** flagged yet. Track it in the F007 security pack if the eval corpus
  shows real-world usage.
- `window.eval(…)` is out of scope: this analyzer targets Node.js backends.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"backend-doctor/no-eval": "error",
		// or silence it deliberately:
		// "backend-doctor/no-eval": "off",
	},
});
```
