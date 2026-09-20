# backend-doctor/no-any-in-dto

Reports DTO fields typed `any` — the field that switches validation and type
checking off end to end.

- **Category:** Maintainability
- **Default severity:** `warn`

## Problem

An `any` field in a request DTO is a hole in every layer at once: the
compiler stops checking what your services receive, the runtime accepts any
shape, and refactoring tooling goes blind. Combined with a `ValidationPipe`
it also means the field is never validated (`any` defeats every
`class-validator` check you might add later). DTOs exist to name the shape
of the wire — give every field a real type.

## Bad

```ts
// ❌ three spellings of the same hole
export class CreateItemDto {
	metadata: any;
	tags: any[];
	payload: Array<any>;

	// ❌ no annotation, no initializer — implicitly any
	note;
}
```

## Good

```ts
// ✅ name the shape, even when it is open-ended
interface ItemMetadata {
	[key: string]: string | number | boolean;
}

export class CreateItemDto {
	metadata: ItemMetadata;
	tags: string[];
	payload: CreateItemPayload;
}
```

## Scope notes (precision over recall, constitution §2)

- Flags the explicit forms `any`, `any[]` and `Array<any>` (whitespace-
  collapsed comparison) and untyped properties with no initializer
  (implicitly `any`).
- An untyped property **with** an initializer stays silent — its type may be
  intentionally inferred; flagging it would cry wolf.
- Fires per property, at the property position; a field may also be reported
  by `backend-doctor/dto-field-without-validator` — the findings are
  distinct (validation vs. typing).

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/no-any-in-dto": "error",
		// or silence it deliberately:
		// "backend-doctor/no-any-in-dto": "off",
	},
});
```
