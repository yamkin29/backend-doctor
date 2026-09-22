# backend-doctor/env-without-validation

Flags a codebase that reads environment variables but never validates
them against a schema.

- **Category:** Configuration
- **Default severity:** `warn`

## Problem

An unvalidated environment is a runtime crash waiting for a deploy:
a missing or misspelled variable (`DATBASE_URL`) surfaces as a
`undefined` value deep in request handling instead of a clear startup
error. Parsing the whole environment once with a schema turns every
missing or malformed variable into an actionable boot failure.

## Detection

Project-scope check (spec 014 resolution 3):

1. the engine collects the env-access census (the
   `no-direct-process-env` access shapes) over all analyzed files;
2. if any analyzed file imports one of the pinned validation libraries —
   `zod`, `class-validator`, `joi`, `envalid`, `convict`,
   `env-schema` (exact specifier or `name/…` subpath) — the rule stays
   silent;
3. otherwise it reports exactly one diagnostic, positioned at the first
   access in file-sorted order, with the total read count in the
   message.

`@nestjs/config` is deliberately not a marker: `ConfigModule` does not
validate anything without a schema, and the schema library itself is
what gets imported.

## Bad

```ts
// ❌ three reads, nothing guarantees they exist or parse
export const settings = {
	databaseUrl: process.env.DATABASE_URL,
	port: Number(process.env.PORT),
};
```

## Good

```ts
// ✅ one schema owns the whole environment
import { z } from "zod";

const envSchema = z.object({
	DATABASE_URL: z.string().url(),
	PORT: z.coerce.number().default(3000),
});

export const settings = envSchema.parse(process.env);
```

## Scope notes (precision over recall, constitution §2)

Not flagged / known limits:

- partial validation counts as validated — one pinned import anywhere
  silences the rule even if other reads bypass the schema;
- hand-rolled validation (`if (!process.env.PORT) throw …`) is NOT
  recognized and stays flagged — a documented false-positive risk; the
  eval corpus (F022) is the precision gate;
- validation through re-exports or wrapper packages (`env-safe` etc.)
  is invisible to the pinned list;
- the census ignores the config/test path exemptions of
  `no-direct-process-env`: reads in config files are exactly the reads
  that must be validated.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Make schema validation a build-breaker:
		"backend-doctor/env-without-validation": "error",
		// or silence it deliberately:
		// "backend-doctor/env-without-validation": "off",
	},
});
```
