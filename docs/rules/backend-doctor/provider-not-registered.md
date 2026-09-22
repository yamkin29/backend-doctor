# backend-doctor/provider-not-registered

Flags constructor injections the consuming module cannot resolve.

- **Category:** Correctness
- **Default severity:** `warn`

## Problem

Nest resolves a constructor parameter through the consumer's module: the
provider must be listed by that module, or exported by a module it imports
(transitively), or exported by a `@Global` module. When none holds, the app
fails at bootstrap with `Nest can't resolve dependencies of …` — an error that
only shows up at runtime, often for the first time in production.

## Bad

```ts
// ❌ OrphanService exists but no module lists it
@Injectable()
export class OrphanService {}

@Module({
	controllers: [TasksController],
	providers: [TasksService], // OrphanService missing
})
export class TasksModule {}

@Controller("tasks")
export class TasksController {
	constructor(private readonly orphan: OrphanService) {} // ← bootstrap crash
}
```

## Good

```ts
// ✅ register the provider in the consuming module
@Module({
	controllers: [TasksController],
	providers: [TasksService, OrphanService],
})
export class TasksModule {}

// ✅ or import a module that exports it
@Module({
	imports: [OrphanModule],
	controllers: [TasksController],
	providers: [TasksService],
})
export class TasksModule {}
```

## Scope notes (precision over recall, constitution §2)

- Matched by class **name** as written; duplicate class names across files
  alias (import-path resolution is F013 graph work).
- Only injection targets that are known `@Injectable` classes are checked —
  string tokens, DTOs, third-party classes and plain interfaces are skipped.
- A consumer with no owning module is never flagged (nothing to resolve
  against).
- Fail-open by design: modules with unreadable metadata (`useFactory`
  elements, spreads — reported under `projects[].nest.unresolved`), import
  names without a model entry, and `@Optional` parameters never produce
  findings.
- Re-exports count only for importers: a module that merely re-exports a
  provider cannot inject it itself.
- `@Self()`, `@SkipSelf()` and property injection are treated as ordinary
  injections (documented holes).

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Promote to a blocking error in CI once the noise budget is known:
		"backend-doctor/provider-not-registered": "error",
		// or silence it deliberately:
		// "backend-doctor/provider-not-registered": "off",
	},
});
```
