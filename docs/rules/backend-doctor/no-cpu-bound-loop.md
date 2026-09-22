# backend-doctor/no-cpu-bound-loop

Flags loops bounded by a large numeric literal (≥ 10,000) whose body never
awaits — a provably CPU-bound stretch on the event loop.

- **Category:** Performance
- **Default severity:** `warn`

## Problem

A loop that runs tens of thousands of iterations without ever awaiting is
CPU work on the event loop: every other request, timer and I/O callback
queued behind it waits for the whole run. This is the classic "the server
freezes when someone uploads a big CSV" defect. When the body contains an
`await`, each iteration yields and the loop stays responsive — such loops
are not flagged. Module top level is exempt (one-time boot work), like the
rest of the blocking pack.

The rule is a **heuristic** with deliberately low recall: a literal bound is
the only shape where the iteration count is provably at least the literal.
See Scope notes for what is undetectable statically.

## Bad

```ts
// ❌ 100,000 iterations of pure CPU on the event loop
export function checksum(rows: number[][]): number {
	let total = 0;
	for (let i = 0; i < 100_000; i++) {
		total += expensiveTransform(rows[i]);
	}
	return total;
}

// ❌ same problem in while / do…while form
let i = 0;
while (i < 250_000) {
	schedule[i] = compute(i);
	i++;
}
```

## Good

```ts
// ✅ yield between chunks so the loop keeps serving
export async function checksum(rows: number[][]): Promise<number> {
	let total = 0;
	for (let i = 0; i < rows.length; i++) {
		total += expensiveTransform(rows[i]);
		if (i % 1000 === 0) await new Promise((resolve) => setImmediate(resolve));
	}
	return total;
}

// ✅ or move the heavy work to a worker thread / queue
```

## Scope notes (precision over recall, constitution §2)

Detected shape: a `for`, `while` or `do…while` statement inside a function
body whose condition compares (`<`, `>`, `<=`, `>=`, either operand order)
against a numeric literal ≥ 10,000, when no `await` in the loop's own body
yields. Underscore separators (`2_000_000`) are normalized; `0x…` and
exponent literals work through `Number()`.

Not flagged (documented recall holes):

- variable bounds (`i < limit`) — the most common real shape, but the
  cardinality is unknowable statically; flagging every loop would burn the
  FP budget;
- computed bounds (`i < 2 ** 31`) — not a single numeric literal;
- bounds below 10,000 — considered normal iteration;
- `while (true)` and other unbounded loops — need reachability analysis;
  deferred until after the eval corpus (F022);
- awaits inside nested async callbacks do not suppress the finding (the
  callback runs concurrently while the loop still blocks) — only an `await`
  in the loop's own body counts.

Runtime attribution of actual blocking (which loop, how many milliseconds)
is F019; this rule is the static first line of defense.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"backend-doctor/no-cpu-bound-loop": "error",
		// or silence it deliberately:
		// "backend-doctor/no-cpu-bound-loop": "off",
	},
});
```
