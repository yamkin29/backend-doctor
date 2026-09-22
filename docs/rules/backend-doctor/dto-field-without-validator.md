# backend-doctor/dto-field-without-validator

Reports DTO fields with no validation decorator — fields a global
`ValidationPipe` will never check.

- **Category:** Correctness
- **Default severity:** `warn`

## Problem

A DTO class only validates input when its fields carry `class-validator`
decorators; with the global `ValidationPipe` enabled, an undecorated field
is simply passed through unchecked (or stripped under `whitelist: true`).
Either way the type annotation lies: `email: string` accepts `42`, arrays,
or objects. Every field in a request DTO needs at least one validator.

## Bad

```ts
// ❌ neither field is validated — the pipe ignores both
export class CreateUserDto {
	email: string;

	@ApiProperty()
	role: string;
}
```

## Good

```ts
// ✅ every field carries a validator
import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class CreateUserDto {
	@IsString()
	email: string;

	@IsOptional()
	@IsString()
	nickname?: string;

	@ApiProperty() // metadata + a validator: both needed
	@ValidateNested()
	profile: ProfileDto;
}
```

## Scope notes (precision over recall, constitution §2)

- A field counts as validated when it carries any decorator outside the
  known non-validator set (`ApiProperty*`, GraphQL `Field`/`HideField`,
  class-transformer `Expose`/`Exclude`/`Type`/`Transform`, TypeORM column
  decorators). Unknown custom validators therefore never produce false
  positives — the recall cost is deliberate.
- Fires per property, at the property position; static properties, methods
  and accessors are ignored.
- Fields typed `any` are reported separately by
  `backend-doctor/no-any-in-dto`.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/dto-field-without-validator": "error",
		// or silence it deliberately:
		// "backend-doctor/dto-field-without-validator": "off",
	},
});
```
