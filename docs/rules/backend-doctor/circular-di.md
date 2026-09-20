# backend-doctor/circular-di

Reports provider dependency cycles — one diagnostic per cycle.

- **Category:** Architecture
- **Default severity:** `warn`

## Problem

When provider A injects B and B (directly or through a chain) injects A, the
dependency graph has a knot. Nest cannot construct such providers with plain
constructor injection: a forwardRef-less cycle crashes at bootstrap, and a
cycle held together with `forwardRef()` works but locks two (or more) classes
into one unit that cannot be built, tested or replaced independently.

## Bad

```ts
// ❌ three providers tied into a knot
@Injectable()
export class OrderService {
	constructor(private readonly billing: BillingService) {}
}
@Injectable()
export class BillingService {
	constructor(private readonly inventory: InventoryService) {}
}
@Injectable()
export class InventoryService {
	constructor(private readonly orders: OrderService) {}
}
```

## Good

```ts
// ✅ extract the shared concern into a third provider everyone depends on
@Injectable()
export class OrderTotals {
	recalculate(): number {
		return 0;
	}
}
@Injectable()
export class OrderService {
	constructor(private readonly totals: OrderTotals) {}
}
@Injectable()
export class BillingService {
	constructor(private readonly totals: OrderTotals) {}
}

// ✅ when the mutual pair is truly irreducible, forwardRef on both sides
@Injectable()
export class AService {
	constructor(
		@Inject(forwardRef(() => BService)) private readonly b: BService,
	) {}
}
```

## Scope notes (precision over recall, constitution §2)

- One diagnostic per cyclic component, reported at the canonical member (the
  alphabetically first `(filePath, className)`); the message contains the
  deterministic cycle path. Other members' files stay silent.
- Only provider→provider constructor edges are graphed, matched by class
  **name** as written; string tokens, DTOs and unknown classes are not edges.
- A cycle without any `forwardRef()` edge is additionally reported by
  `backend-doctor/missing-forward-ref` at the parameter that closes the
  cycle — the two diagnostics answer "what is wrong" and "why it crashes".
- Self-injection (`A` injecting `A`) counts as a cycle.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/circular-di": "error",
		// or silence it deliberately:
		// "backend-doctor/circular-di": "off",
	},
});
```
