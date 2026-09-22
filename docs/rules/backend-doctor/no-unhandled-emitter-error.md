# backend-doctor/no-unhandled-emitter-error

Flags `emit("error", …)` on an `EventEmitter` that has no `'error'`
listener registered.

- **Category:** Bugs
- **Default severity:** `warn`

## Problem

In Node.js an `'error'` event with no listener is special: the process
throws an uncaught exception and dies. Every other event can be emitted
safely without subscribers — `'error'` cannot. A code path that emits
`'error'` on a bus nobody subscribed to turns a recoverable failure into a
production crash.

## Bad

```ts
// ❌ nobody listens — the first emit crashes the process
const emitter = new EventEmitter();
emitter.emit("error", new Error("boom"));

// ❌ same with a class property
class Bus {
	private emitter = new EventEmitter();
	fail(): void {
		this.emitter.emit("error", new Error("x"));
	}
}
```

## Good

```ts
// ✅ register the listener before emitting
const emitter = new EventEmitter();
emitter.on("error", (error: Error) => {
	logger.error("bus failure", error);
});
emitter.emit("error", new Error("boom"));

// ✅ or emit an ordinary event type
emitter.emit("close");
```

## Scope notes (precision over recall, constitution §2)

- Tracked receivers are variables initialized from `new EventEmitter()`
  and `this.<property>` initialized the same way (property initializer or
  constructor assignment). Receiver identity is **binding-aware**: an
  `emitter` parameter inside another function is never confused with a
  tracked module-level emitter of the same name.
- Listener registrations counted: `.on("error")`, `.once("error")`,
  `.addListener("error")`, `.prependListener("error")`.
- Not tracked (documented recall holes): subclass instances
  (`new MyEmitter()`), `events.EventEmitter` property form, receivers
  passed across function boundaries, non-literal event names, and keys
  initialized more than once in a file (ambiguous identity). Listener
  registration anywhere in the file counts, even after the emit.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"backend-doctor/no-unhandled-emitter-error": "error",
		// or silence it deliberately:
		// "backend-doctor/no-unhandled-emitter-error": "off",
	},
});
```
