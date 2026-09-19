# backend-doctor/no-async-constructor-work

Flags async work started directly inside constructors.

- **Category:** Correctness
- **Default severity:** `warn`

## Problem

A constructor cannot await: any promise it starts is fire-and-forget, so
initialization races with the first use of the object. The object exists
before its dependencies loaded — the first request hits an uninitialized
service, a cache that is still empty, a connection that is not open yet.

## Bad

```ts
// ❌ async method fired from the constructor
class Server {
	async start(): Promise<void> {}
	constructor() {
		this.start();
	}
}

// ❌ same via a helper function
async function bootstrap(): Promise<void> {}
class App {
	constructor() {
		bootstrap();
	}
}
```

## Good

```ts
// ✅ an explicit init step the caller awaits
class Server {
	async start(): Promise<void> {}
}
const server = new Server();
await server.start();

// ✅ intentional fire-and-forget, marked as such
class App {
	async start(): Promise<void> {}
	constructor() {
		void this.start();
	}
}
```

## Scope notes (precision over recall, constitution §2)

- Detected forms mirror `no-floating-promises` (same-file async functions,
  `this.<asyncMethod>()`, unshadowed `fetch`) but restricted to constructor
  bodies; constructor bodies are owned **exclusively** by this rule — the
  floating-promise rule skips them, so one violation yields one diagnostic.
- `void`-prefixed calls are not flagged (documented intent).
- Nest-specific advice (move heavy work to `onModuleInit`, constructor
  blocking in the DI graph) is out of scope here — see F009/F011.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"backend-doctor/no-async-constructor-work": "error",
		// or silence it deliberately:
		// "backend-doctor/no-async-constructor-work": "off",
	},
});
```
