# backend-doctor/no-unsafe-raw-query

Reports raw Prisma queries whose SQL text is built dynamically — the SQL
injection vector of the `$queryRawUnsafe`/`$executeRawUnsafe` APIs and of
concatenation into the raw-query calls.

- **Category:** Security
- **Default severity:** `warn`

## Problem

Interpolated or concatenated SQL executes anything a request carries as
SQL. Prisma's raw APIs make the safe path easy — values inside a
*tagged-template* call become bound parameters — and the unsafe path easy
too: `$queryRawUnsafe`/`$executeRawUnsafe` accept a string you built, and a
plain (non-tagged) call with concatenated text silently loses the
parameterization. One interpolated `req.params.id` is all it takes.

## Bad

```ts
// ❌ untracked string built by hand — injection
const users = await prisma.$queryRawUnsafe(
	`SELECT * FROM "User" WHERE name = '${name}'`,
);

// ❌ concatenation — same injection, older syntax
await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE id = ' + id);
```

## Good

```ts
// ✅ tagged template: values become bound parameters
const users = await prisma.$queryRaw`SELECT * FROM "User" WHERE name = ${name}`;

// ✅ composed fragments stay parameterized too
const ids = Prisma.join(ids);
const rows = await prisma.$queryRawUnsafe(
	Prisma.sql`SELECT * FROM "User" WHERE id IN (${ids})`,
);

// ✅ fully static text has nothing to inject
const all = await prisma.$queryRawUnsafe("SELECT * FROM \"User\"");
```

## Scope notes (precision over recall, constitution §2)

- Vocabulary: `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`,
  `$executeRawUnsafe` as property-access callees. The tagged-template call
  form is not a function call in the AST and never matches.
- Dynamic text means: a template literal with at least one interpolation,
  or a `+` chain with a non-string-literal operand. For the `*Unsafe`
  variants any non-literal argument (variable, call result) counts — their
  contract is untracked provenance; for the plain forms only provably
  dynamic text is flagged.
- `Prisma.sql` arguments are parameterized composition and stay silent.
  Literal strings and span-free templates carry nothing to inject and stay
  silent. The rule runs at every scope (module top level included) and only
  when the `prisma` framework is detected.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/no-unsafe-raw-query": "error",
		// or silence it deliberately:
		// "backend-doctor/no-unsafe-raw-query": "off",
	},
});
```
