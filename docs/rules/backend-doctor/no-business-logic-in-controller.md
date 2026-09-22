# backend-doctor/no-business-logic-in-controller

Reports controller handlers whose bodies carry branching — logic that belongs
in a service.

- **Category:** Architecture
- **Default severity:** `warn`

## Problem

A Nest controller's job is transport: read the request, delegate, shape the
response. The moment a handler starts branching on data it owns a piece of
business policy — and that policy is now unreachable from other controllers,
CLI jobs, or tests that do not spin up HTTP. Handlers with branching are
where reuse goes to die.

## Bad

```ts
// ❌ validation policy and normalisation live in the controller
@Post()
register(@Body() dto: RegisterDto): { ok: boolean } {
	if (dto.password !== dto.confirm) {
		throw new BadRequestException("passwords differ");
	}
	if (this.seen.has(dto.email)) {
		throw new ConflictException();
	}
	return this.auth.register(dto);
}
```

## Good

```ts
// ✅ the handler delegates; the service owns the policy
@Post()
register(@Body() dto: RegisterDto): Promise<RegisterResult> {
	return this.auth.register(dto);
}

// ✅ a single guard clause is not business logic
@Get(":id")
one(@Param("id") id: string): string {
	if (!id) {
		throw new NotFoundException();
	}
	return this.users.findOne(id);
}
```

## Scope notes (precision over recall, constitution §2)

- Counts branch points per handler body: `if` statements, loop statements
  (`for`, `for-of`, `for-in`, `while`, `do`), `case` clauses and conditional
  (ternary) expressions. Fires at 2 or more. `default:` arms and logical
  operators (`&&`, `||`) are not counted.
- One diagnostic per handler, at the verb-decorator position.
- Only verb-decorated methods count (plain helper methods on the controller
  are not flagged).
- Deterministic heuristic, not type-aware: it measures branching, not
  intent. A handler delegating to a service through a conditional is still
  reported — move the condition into the service.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/no-business-logic-in-controller": "error",
		// or silence it deliberately:
		// "backend-doctor/no-business-logic-in-controller": "off",
	},
});
```
