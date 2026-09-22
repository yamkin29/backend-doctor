# backend-doctor/no-prisma-n-plus-one

Reports a Prisma read query awaited directly inside a loop body — one
database round-trip per iteration (N+1).

- **Category:** Performance
- **Default severity:** `warn`

## Problem

Every pass through the loop waits on its own query: a loop over 200 users
fires 201 queries, the response latency grows with the data set, and the
connection pool saturates under concurrency — the classic reason a Prisma
endpoint is fine in development and times out in production. Prisma can
express almost every such loop as a single query: relations load with
`include`/`select`, id lists batch with `findMany({ where: { id: { in: ids }
} })`, and aggregations fold into `aggregate`/`groupBy`.

## Bad

```ts
// ❌ one round-trip per user
const users = await prisma.user.findMany();
for (const user of users) {
	const posts = await prisma.post.findMany({
		where: { userId: user.id },
	});
}
```

## Good

```ts
// ✅ one query: related rows loaded with the parents
const users = await prisma.user.findMany({
	include: { posts: true },
});

// ✅ one query: id list batched with `in`
const posts = await prisma.post.findMany({
	where: { userId: { in: userIds } },
});

// ✅ parallel fan-out when the queries are genuinely independent
const allPosts = await Promise.all(
	users.map((user) => prisma.post.findMany({ where: { userId: user.id } })),
);
```

## Scope notes (precision over recall, constitution §2)

- Vocabulary: `findMany`, `findFirst`, `findUnique`, `findFirstOrThrow`,
  `findUniqueOrThrow`, `count`, `aggregate`, `groupBy`, matched as
  property-access callees. Write calls (`create`, `update`, …) are not
  flagged — dependent-row creations have legitimate loop shapes.
- The query must be awaited and sit directly in the loop body (`for`,
  `for…of`, `for…in`, `while`, `do…while`). An unawaited query in a loop is
  reported by `no-floating-promises` instead — no call is reported twice.
- Queries inside nested functions are not attributed to the loop: a
  `Promise.all(items.map(...))` fan-out is the fix, not a finding.
- `this.findMany()` on a class declaring its own `findMany`, and bare
  identifiers shadowed by same-file bindings, are user code and stay
  silent. The rule runs only when the `prisma` framework is detected.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/no-prisma-n-plus-one": "error",
		// or silence it deliberately:
		// "backend-doctor/no-prisma-n-plus-one": "off",
	},
});
```
