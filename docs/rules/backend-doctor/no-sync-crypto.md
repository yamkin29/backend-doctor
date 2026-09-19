# backend-doctor/no-sync-crypto

Flags synchronous `node:crypto` calls made inside function bodies — key
derivation and random-byte generation that block the event loop.

- **Category:** Performance
- **Default severity:** `warn`

## Problem

Synchronous crypto is CPU-bound work with an unbounded price tag:
`pbkdf2Sync` and `scryptSync` burn the full derivation cost on the event
loop — easily hundreds of milliseconds at recommended iteration counts —
and a callback-less `randomBytes` blocks for its entropy gathering. While
one password is being verified, the whole process serves nobody. The async
forms of these APIs hand the work to the thread pool so the loop keeps
serving. Module top level is exempt: one-time boot work is idiomatic.

The rule is a **heuristic** and always flags the sync forms regardless of
framework (see Scope notes).

## Bad

```ts
import crypto from "node:crypto";

// ❌ full KDF cost on the event loop, per login attempt
export function verifyPassword(
	password: string,
	salt: string,
	expected: Buffer,
): boolean {
	return timingSafeEqual(crypto.pbkdf2Sync(password, salt, 310_000, 32, "sha256"), expected);
}

// ❌ callback-less randomBytes is the sync form
export function sessionToken(): string {
	return randomBytes(32).toString("hex");
}
```

## Good

```ts
import { pbkdf2, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { timingSafeEqual } from "node:crypto";

const pbkdf2Async = promisify(pbkdf2);

// ✅ promisified KDF — the thread pool does the burning
export async function verifyPassword(
	password: string,
	salt: string,
	expected: Buffer,
): Promise<boolean> {
	const derived = await pbkdf2Async(password, salt, 310_000, 32, "sha256");
	return timingSafeEqual(derived, expected);
}

// ✅ callback form — async
export function sessionToken(callback: (token: string) => void): void {
	randomBytes(32, (error, buffer) => {
		callback(buffer.toString("hex"));
	});
}
```

## Scope notes (precision over recall, constitution §2)

Always flagged: `pbkdf2Sync`, `scryptSync`, `generateKeyPairSync`,
`generatePrimeSync`, `hkdfSync`, `randomFillSync`. Flagged only in their
callback-less (sync) form: `randomBytes`, `randomFill` — passing a second
(callback) argument makes the call async and suppresses the finding.
Detected callee forms and the module-import gate (`crypto`, `node:crypto`)
work exactly as in `no-sync-fs-in-request-path`; a spread-only argument
list is indistinguishable from the sync form.

Not flagged (documented recall holes):

- calls at module top level;
- aliased named imports and files that never import a crypto module;
- `crypto.createHash`/`createCipheriv` and friends — synchronous but cheap
  for typical payloads;
- sync `crypto.sign`/`crypto.verify` (the default callback-less forms) —
  revisit after the eval corpus (F022) if real findings appear.

Weak-algorithm detection (`md5`, `sha1`, weak ciphers) is a security
concern and belongs to F007, not this rule.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"backend-doctor/no-sync-crypto": "error",
		// or silence it deliberately:
		// "backend-doctor/no-sync-crypto": "off",
	},
});
```
