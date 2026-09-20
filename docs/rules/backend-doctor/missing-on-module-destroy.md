# backend-doctor/missing-on-module-destroy

Reports providers that acquire resources in an init hook but never release
them — nothing runs the cleanup on shutdown.

- **Category:** Correctness
- **Default severity:** `warn`

## Problem

`onModuleInit` is where providers open connections, start timers and grab
file handles. Without a matching shutdown hook the resource outlives every
consumer: graceful shutdown hangs on open handles, timers keep the process
alive, connections are dropped uncleanly. Nest gives you the destroy side of
the lifecycle for free — the rule only asks you to use it when you used the
init side.

## Bad

```ts
// ❌ starts an interval nothing will ever stop
@Injectable()
export class TimerService {
	private timer?: ReturnType<typeof setInterval>;

	onModuleInit(): void {
		this.timer = setInterval(() => {}, 1000);
	}
}
```

## Good

```ts
// ✅ every acquire has a release
@Injectable()
export class TimerService implements OnModuleInit, OnModuleDestroy {
	private timer?: ReturnType<typeof setInterval>;

	onModuleInit(): void {
		this.timer = setInterval(() => {}, 1000);
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}
}
```

## Scope notes (precision over recall, constitution §2)

- Init hooks: `onModuleInit`, `onApplicationBootstrap`. Any one of
  `onModuleDestroy`, `beforeApplicationShutdown`, `onApplicationShutdown`
  counts as cleanup and silences the rule.
- Fires only for `@Injectable` providers known to the application model;
  controllers and classes outside the model stay silent.
- Method-name matching: `implements OnModuleInit` and a bare `onModuleInit()`
  declaration are treated the same.
- One diagnostic per provider, at the class position.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/missing-on-module-destroy": "error",
		// or silence it deliberately:
		// "backend-doctor/missing-on-module-destroy": "off",
	},
});
```
