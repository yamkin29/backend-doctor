# backend-doctor/request-scoped-in-singleton

Flags request-scoped providers injected into singleton consumers.

- **Category:** Performance
- **Default severity:** `warn`

## Problem

Nest propagates request scope up the dependency chain: the moment a
request-scoped provider is injected into a default-scope (singleton) consumer,
that consumer — and everything it carries — becomes request-scoped too. What
looked like a per-request helper quietly turns half the application graph into
per-request allocations: slower requests, more GC pressure, broken singleton
assumptions (cached state, event listeners, connections) with no error at all.

## Bad

```ts
// ❌ per-request context pulled into a singleton service
@Injectable({ scope: Scope.REQUEST })
export class RequestContext {
	readonly traceId = randomUUID();
}

@Injectable()
export class OrdersService {
	constructor(private readonly ctx: RequestContext) {} // OrdersService is
	// now rebuilt on every request — silently
}
```

## Good

```ts
// ✅ pass the request data explicitly, keep the consumer a singleton
@Injectable()
export class OrdersService {
	handle(ctx: RequestContext): void {} // argument, not an injection
}

// ✅ or make the consumer request-scoped deliberately (the cost is explicit)
@Injectable({ scope: Scope.REQUEST })
export class SessionService {
	constructor(private readonly ctx: RequestContext) {}
}
```

## Scope notes (precision over recall, constitution §2)

- Fires per injection edge at the parameter: the edge is where the decision
  happens. Controllers count as singleton consumers; a consumer already marked
  `Scope.REQUEST` (or `Scope.TRANSIENT`) is deliberate usage and stays silent.
- Scope is read only from static shapes — `Scope.REQUEST`/`Scope.DEFAULT`/
  `Scope.TRANSIENT` or the `"request"|"singleton"|"transient"` literals;
  computed scopes are ignored (the provider reads as default scope).
- A transient consumer of a request-scoped provider is a documented recall
  hole.
- Only provider→consumer constructor edges, matched by class **name** as
  written.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/request-scoped-in-singleton": "error",
		// or silence it deliberately:
		// "backend-doctor/request-scoped-in-singleton": "off",
	},
});
```
