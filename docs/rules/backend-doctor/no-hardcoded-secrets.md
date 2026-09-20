# backend-doctor/no-hardcoded-secrets

Flags string literals that look like real credentials under secret-shaped
names.

- **Category:** Security
- **Default severity:** `warn`

## Problem

A credential in source control outlives every rotation policy: everyone who
ever cloned the repo has it, and git history keeps it after deletion.
Committed secrets leak through CI logs, forked repos, and package
publishing. The fix is to load them from the environment or a secret
manager.

The rule is a heuristic: a pinned list of compound secret names plus two
deterministic thresholds (no network, no LLM — constitution §1).

## Detection

A variable declaration, class property, or object key matches when:

1. its name, normalized (lowercased, `_`/`-`/`$`/spaces removed), *contains*
   one of the pinned compound names: `password`, `passwd`, `apikey`,
   `apisecret`, `secretkey`, `accesskey`, `secretaccesskey`, `authtoken`,
   `accesstoken`, `refreshtoken`, `clientsecret`, `privatekey`, `appsecret`,
   `encryptionkey`, `signingkey`, `sessionsecret`, `webhooksecret`,
   `dbpassword`, `dbpass`, `awssecretaccesskey`;
2. the initializer is a string literal of length ≥ 16 **and** Shannon
   entropy ≥ 3.0 bits (sixteen distinct characters score 4.0; random
   base62 keys score ~4.5; `aaaa-bbbb-cccc-dddd` scores ~2.1).

## Bad

```ts
// ❌ anyone with the source has the production key
const apiKey = "sk_live_9fK3pXwR7vTqzLm5Yh8Cd1BnJ2";
```

## Good

```ts
// ✅ the credential lives outside the repository
function apiKey(): string {
	const value = process.env.PAYMENTS_API_KEY;
	if (!value) throw new Error("PAYMENTS_API_KEY is not configured");
	return value;
}
```

## Scope notes (precision over recall, constitution §2)

Not flagged (documented recall holes):

- non-literal initializers (`process.env.X`, concatenation, base64 at
  runtime) — that is the fix, not a finding;
- literals shorter than 16 characters or below the entropy threshold —
  short low-entropy passwords are missed by design; a placeholder
  denylist would trade this hole for noise (spec 007 open question 4);
- ambiguous bare names (`secret`, `token`, `key`, `credentials`) —
  `cacheToken` and `mapKey` would burn the false-positive budget;
- assignments to existing variables and non-identifier declarations
  (destructuring);
- secrets in `.json`/`.yml`/`.env` files — the engine scans TypeScript
  sources only.

Value-shape regexes (`sk_live_…`, `AKIA…`, `-----BEGIN … PRIVATE KEY-----`)
are a complementary, higher-recall strategy deliberately deferred (spec 007
design §4).

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Treat leaked credentials as build-breakers:
		"backend-doctor/no-hardcoded-secrets": "error",
		// or silence it deliberately:
		// "backend-doctor/no-hardcoded-secrets": "off",
	},
});
```
