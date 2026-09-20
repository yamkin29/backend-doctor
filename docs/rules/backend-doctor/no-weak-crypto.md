# backend-doctor/no-weak-crypto

Flags `createHash("md5")` and `createHash("sha1")` calls.

- **Category:** Security
- **Default severity:** `warn`

## Problem

MD5 is fully broken (collisions are practical) and SHA-1 has known
practical collision attacks. Hashes are the one primitive where a broken
algorithm is silently interchangeable: `createHash("md5")` type-checks and
works exactly like `createHash("sha256")` while destroying every guarantee
that depends on collision resistance — signatures, password derivation,
token fingerprints, integrity checks. There is no top-level exemption: a
weak hash is weak wherever it runs.

## Bad

```ts
import { createHash } from "node:crypto";

// ❌ collision-prone fingerprint of a session token
export function fingerprint(token: string): string {
	return createHash("md5").update(token).digest("hex");
}
```

## Good

```ts
import { createHash } from "node:crypto";

// ✅ SHA-256 for fingerprints
export function fingerprint(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
```

For passwords and key derivation, a hash is not enough even in SHA-256 —
use a memory-hard KDF (`argon2`, `scrypt`, `bcrypt`).

## Scope notes (precision over recall, constitution §2)

Flagged: `createHash` calls in files referencing `crypto`/`node:crypto`
whose first argument is a string literal equal to `md5` or `sha1`
(case-insensitive: `"MD5"` counts). Property form on any receiver plus bare
named imports, with the usual shadow check.

Known acceptable use: non-security checksums (cache keys, etags) where
collision resistance does not matter. If your codebase uses md5 only for
those, downgrade or ignore the rule per file via `ignore.files` rather than
restructuring working cache logic.

Not flagged (documented recall holes):

- non-literal algorithms (`createHash(algorithm)`);
- other weak primitives: `createCipheriv("des", …)`, `md4`/`ripemd160` in
  hash form, short ECB ciphers — no PLAN line in v1;
- hash length/size misuse (truncated digests).

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Escalate once the md5 cache keys are migrated:
		"backend-doctor/no-weak-crypto": "error",
		// or silence it deliberately:
		// "backend-doctor/no-weak-crypto": "off",
	},
});
```
