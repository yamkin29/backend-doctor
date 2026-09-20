# backend-doctor/unused-dependency

Reports `package.json` `dependencies` entries nothing references — install
weight, audit surface, and a package.json that lies about what the app
needs.

- **Category:** Maintainability
- **Default severity:** `warn`

## Problem

A dependency nobody imports still gets installed on every CI run, still
shows up in `npm audit`, and still tells every reader it is load-bearing.
Leftover dependencies usually mean the code moved on — to another package,
to the platform, or away entirely — and package.json never followed.

## Bad

```json
{
	"dependencies": {
		"express": "^4.19.0",
		"left-pad": "^1.3.0"
	}
}
```

```ts
// the whole codebase imports express — nothing imports left-pad
import express from "express";
```

## Good

```json
{
	"dependencies": { "express": "^4.19.0" },
	"devDependencies": { "vitest": "^3.0.0" }
}
```

Remove the entry — or move it to `devDependencies` when only tooling uses
it.

## Scope notes (precision over recall, constitution §2)

- Only `dependencies` are checked; `devDependencies` never fire (binaries
  and test tooling are not imported).
- `@types/*` is exempt (it types the package it is named after), and
  non-registry specifiers — `workspace:`, `file:`, `link:`, git URLs — are
  exempt: they carry no published package.
- A package counts as used when any analyzed module specifier equals it or
  extends it (`name/...`), or when any `scripts` string mentions it (CLI
  usage). Computed specifiers (`` import(`./x/${name}`) ``) are a
  documented recall hole. Framework-free.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/unused-dependency": "error",
		// or silence it deliberately:
		// "backend-doctor/unused-dependency": "off",
	},
});
```
