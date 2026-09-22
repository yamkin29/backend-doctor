# backend-doctor/no-heavy-constructor-work

Reports process spawning and connection establishment inside provider
constructors — heavy work that belongs in `onModuleInit`.

- **Category:** Correctness
- **Default severity:** `warn`

## Problem

A constructor runs the moment the DI container instantiates the class —
before its dependencies are wired, before the application is ready, with no
way to await it. Spawn a process or dial a database there and startup
stalls, a failure at construction takes down the container with a confusing
stack, and async connects become unawaited floating promises. Nest has the
right hook for exactly this: `onModuleInit` runs after dependencies are
resolved and can be awaited before the app starts serving traffic.

## Bad

```ts
// ❌ spawns git before DI completes
@Injectable()
export class SpawnSyncService {
	constructor() {
		this.revision = execSync("git rev-parse HEAD").toString().trim();
	}
}

// ❌ dials the database from the constructor — unawaited, unraced-safe
@Injectable()
export class RedisService {
	constructor() {
		void this.client.$connect();
	}
}
```

## Good

```ts
// ✅ initialize in the lifecycle, after dependencies are resolved
@Injectable()
export class RedisService implements OnModuleInit {
	constructor(private readonly client: RedisClient) {}

	async onModuleInit(): Promise<void> {
		await this.client.$connect();
	}
}
```

## Scope notes (precision over recall, constitution §2)

- Vocabulary: `child_process` (`exec`, `execSync`, `execFile`,
  `execFileSync`, `spawn`, `spawnSync`, `fork`) and member calls named
  `connect` / `$connect`, inside the constructor body of an `@Injectable`
  provider known to the application model. Controllers are out of scope.
- Deliberately not flagged here: sync fs/crypto calls (already reported by
  `no-sync-fs-in-request-path` / `no-sync-crypto`) and same-file async calls
  (owned by `no-async-constructor-work`) — no call is reported twice.
- Own-class members (`this.connect()` on a class declaring `connect`) and
  bare identifiers shadowed by same-file bindings are treated as user code
  and stay silent. Work in nested callbacks is not attributed to the
  constructor.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/no-heavy-constructor-work": "error",
		// or silence it deliberately:
		// "backend-doctor/no-heavy-constructor-work": "off",
	},
});
```
