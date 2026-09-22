# backend-doctor/no-path-traversal

Flags paths built with `path.join`/`path.resolve` from request-derived
segments — the `..` escape shape.

- **Category:** Security
- **Default severity:** `warn`

## Problem

`path.join("/uploads", req.params.file)` happily joins `../../etc/passwd`:
`..` segments escape the intended directory, and absolute inputs replace it.
An attacker reads or overwrites arbitrary files the process can access.
`path.basename` (or an allowlist of names) is the fix. Module top level is
**not** exempt.

The rule approximates "request data" by property chains rooted at the
identifiers `req`/`request` — the near-universal Express/Nest naming.

## Bad

```ts
import path from "node:path";
import fs from "node:fs";

// ❌ "..%2F..%2Fetc%2Fpasswd" survives decoding into "..\/..\/etc\/passwd"
export function serve(req: { params: { file: string } }): Buffer {
	return fs.readFileSync(path.join("/uploads", req.params.file));
}
```

## Good

```ts
import path from "node:path";
import fs from "node:fs";

// ✅ basename strips any directory components the client sent
export function serve(req: { params: { file: string } }): Buffer {
	return fs.readFileSync(path.join("/uploads", path.basename(req.params.file)));
}
```

## Scope notes (precision over recall, constitution §2)

Flagged: `path.join`/`path.resolve` calls in files referencing
`path`/`node:path` where any argument is (or composes, via template
substitutions or `+` concatenation) a property chain rooted at
`req`/`request`. The property form requires the receiver to be literally the
identifier `path` — `join`/`resolve` collide with `Array.prototype.join` and
friends; bare named imports keep the shadow check. Template and
concatenation composites are matched; spread arguments are skipped.

Not flagged (documented recall holes):

- other root names (`ctx`, `c`, Hono's conventions) — no taint analysis yet
  (F008/F013 will tighten this);
- element access `req["params"]["file"]`;
- aliased default imports (`import pa from "node:path"`) and
  `require("path").join(...)`;
- request-derived values passed to `fs.readFile` and friends directly,
  without a `path.*` call;
- `req` passed whole (the identifier alone is not a path component).

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Escalate in CI once findings are triaged:
		"backend-doctor/no-path-traversal": "error",
		// or silence it deliberately:
		// "backend-doctor/no-path-traversal": "off",
	},
});
```
