# backend-doctor/unhandled-json-parse

Flags `JSON.parse(…)` inside function bodies with no enclosing try/catch.

- **Category:** Bugs
- **Default severity:** `warn`

## Problem

`JSON.parse` throws on any malformed input. Inside a request path an
unguarded throw means a 500 (or a crashed worker) triggered by whatever
payload arrived — a user typo, a truncated body, a probe sending garbage.
The rule targets exactly that: parse calls reachable at request time that
have no catch clause between them and safety.

## Bad

```ts
// ❌ throws at request time on malformed input
function parsePayload(raw: string): unknown {
	return JSON.parse(raw);
}

// ❌ finally does not catch — still unguarded
function parseOrCleanup(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} finally {
		metrics.increment("parsed");
	}
}
```

## Good

```ts
// ✅ guard the call and handle the failure
function parsePayload(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

// ✅ or validate before parsing (schema validation at the boundary)
const payload = schema.safeParse(raw);
```

## Scope notes (precision over recall, constitution §2)

- `JSON.parse` at **module top level** is not flagged: crash-fast parsing of
  trusted local files during startup is idiomatic, and flagging it burned
  the precision budget in every corpus we looked at.
- Callers that catch upstream of a helper (`try { parse(s) } catch {}` at
  the call site) are not tracked — that needs a call graph (F013 territory).
- Only the exact receiver `JSON.parse` matches; custom parse wrappers are
  out of scope.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"backend-doctor/unhandled-json-parse": "error",
		// or silence it deliberately:
		// "backend-doctor/unhandled-json-parse": "off",
	},
});
```
