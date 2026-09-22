# backend-doctor/find-many-without-pagination

Reports `findMany` calls without a `take` — result sets that scale with the
table instead of the request.

- **Category:** Performance
- **Default severity:** `warn`

## Problem

`findMany` returns every matching row. Without a `take` the query's cost is
decided by the data, not by the caller: a lookup that reads ten rows in the
staging database reads ten million in production, and the payload lands in
memory (and often in the response) in one shot. Pagination — `take` with
`skip` or `cursor` — makes the bound explicit and part of the API contract.

## Bad

```ts
// ❌ every user row, forever
const users = await prisma.user.findMany();

// ❌ `where`/`orderBy` narrow which rows, not how many
const actives = await prisma.user.findMany({
	where: { active: true },
	orderBy: { id: "asc" },
});
```

## Good

```ts
// ✅ explicit page size
const users = await prisma.user.findMany({
	take: 50,
	skip: pageIndex * 50,
});

// ✅ shorthand works too
const page = await prisma.user.findMany({ take, skip });

// ✅ single-row queries are bounded by design
const user = await prisma.user.findFirst({ where: { id } });
```

## Scope notes (precision over recall, constitution §2)

- Vocabulary: `findMany` as a property-access callee. `findFirst`,
  `findUnique` and friends return one row and never match.
- Only the call's own top-level argument object is inspected: a `take`
  property (explicit or shorthand) silences it. Arguments that are not
  object literals — a variable or a spread — are unknown provenance and
  stay silent.
- Pagination of nested relations (`include: { posts: { take: 5 } }`) is out
  of scope; an outer `findMany` without `take` is flagged even when an
  included relation is paginated — the outer result set is the unbounded
  one. The rule runs only when the `prisma` framework is detected.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/find-many-without-pagination": "error",
		// or silence it deliberately:
		// "backend-doctor/find-many-without-pagination": "off",
	},
});
```
