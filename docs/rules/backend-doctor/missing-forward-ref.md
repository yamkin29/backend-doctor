# backend-doctor/missing-forward-ref

Reports injection cycles that use no `forwardRef()` — Nest cannot construct
them.

- **Category:** Correctness
- **Default severity:** `warn`

## Problem

A provider cycle made of plain constructor injections is unbuildable: Nest
detects the knot at bootstrap and throws `A circular dependency has been
detected`. The app does not start. Unlike the general `circular-di` smell,
this is a guaranteed crash, and the fix is mechanical — wrap the type in
`forwardRef(() => X)` on both sides of a mutual pair, or break the cycle.

## Bad

```ts
// ❌ plain constructor injections both ways — the app does not boot
@Injectable()
export class XService {
	constructor(private readonly y: YService) {}
}
@Injectable()
export class YService {
	constructor(private readonly x: XService) {} // ← closing edge
}
```

## Good

```ts
// ✅ forwardRef on both sides of the mutual pair
@Injectable()
export class XService {
	constructor(
		@Inject(forwardRef(() => YService)) private readonly y: YService,
	) {}
}
@Injectable()
export class YService {
	constructor(
		@Inject(forwardRef(() => XService)) private readonly x: XService,
	) {}
}

// ✅ better: break the cycle by extracting the shared concern
@Injectable()
export class SharedTotals {}
```

## Scope notes (precision over recall, constitution §2)

- Fires once per cyclic component, at the parameter that closes the reported
  cycle path; a component already using `forwardRef()` on any path edge is
  silent here (it still gets the `circular-di` architecture diagnostic).
- Provider→provider constructor edges only, matched by class **name** as
  written.
- The diagnostic complements `circular-di`: one names the knot, this one says
  why the app will not start and where the fix goes.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/missing-forward-ref": "error",
		// or silence it deliberately:
		// "backend-doctor/missing-forward-ref": "off",
	},
});
```
