# backend-doctor/no-error-details-leak

Reports stack traces shipped to the client through a response call —
information disclosure of file paths and internal structure.

- **Category:** Security
- **Default severity:** `warn`

## Problem

A stack trace in a response body hands an attacker your directory layout,
module names, library versions and internal call structure — reconnaissance
for free. Server-side, the full error belongs in your logs; the wire only
ever needs a safe, generic payload. The leak almost always starts as debug
code (`stack: err.stack` to "see what's wrong") that survives into
production.

## Bad

```ts
// ❌ Express-style handler
res.status(500).json({ message: "Internal Server Error", stack: err.stack });

// ❌ Nest exception filter
const response = host.switchToHttp().getResponse();
response.status(500).json({ stack: exception.stack });
```

## Good

```ts
// ✅ log server-side, return a generic payload
logger.error(err.stack);
res.status(500).json({ message: "Internal Server Error" });

// ✅ intentional message returns stay fine — messages are not flagged
res.status(400).json({ message: err.message });
```

## Scope notes (precision over recall, constitution §2)

- Fires on a `json`/`send`/`end`/`write` call whose receiver chain is rooted
  at the identifier `res` or `response` (the spec 007 request-root heuristic,
  mirrored) when any argument contains a `.stack` property access. One
  diagnostic per response call, however many stack references it carries.
- `.stack` only: `message`, `cause` and whole error objects are not flagged —
  returning `err.message` for client errors is idiomatic (spec 011
  resolution 1).
- Documented recall holes: receivers named anything else (custom wrappers),
  non-response transports (`throw new HttpException(err.stack, …)`), stacks
  passed through variables into the call (`const s = err.stack;
  res.json({ s })`).

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		"backend-doctor/no-error-details-leak": "error",
		// or silence it deliberately:
		// "backend-doctor/no-error-details-leak": "off",
	},
});
```
