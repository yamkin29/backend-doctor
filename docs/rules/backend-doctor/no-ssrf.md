# backend-doctor/no-ssrf

Flags outbound HTTP calls (`fetch`, `axios`) whose URL is taken from request
input.

- **Category:** Security
- **Default severity:** `warn`

## Problem

Fetching a URL the client controls turns the backend into a proxy into the
network the client cannot reach: cloud metadata endpoints
(`169.254.169.254`), admin panels bound to localhost, internal services
behind the firewall. Even when the response is not echoed back, timing and
error channels leak reachability. The fix is to validate the host against
an allowlist before requesting it.

The rule approximates "request input" with property chains rooted at
`req`/`request` (see `no-path-traversal` for the shared heuristic).

## Bad

```ts
// ❌ the client picks which host the server talks to
export async function preview(req: { query: { url: string } }): Promise<string> {
	const response = await fetch(req.query.url);
	return response.text();
}
```

## Good

```ts
// ✅ only known hosts are fetched, whatever the client sends
const ALLOWED_HOSTS = new Set(["media.partner.example", "cdn.partner.example"]);

export async function preview(req: { query: { url: string } }): Promise<string> {
	const url = new URL(req.query.url);
	if (!ALLOWED_HOSTS.has(url.host)) {
		throw new Error("host is not allowed");
	}
	const response = await fetch(url);
	return response.text();
}
```

## Scope notes (precision over recall, constitution §2)

Flagged: a `fetch(…)` call (bare identifier, shadow-checked — a same-file
`fetch` function is user code, spec 005 precedent) or an
`axios`/`axios.<method>` call (gated on an axios specifier) whose first
argument is, or composes via template substitutions or `+`, a property
chain rooted at `req`/`request`.

Not flagged (documented recall holes):

- other root names (`ctx`, custom middleware names) — no taint analysis
  until F008/F013;
- config-object forms (`axios({ url: req.query.target })`);
- URLs built through intermediate variables or helper functions;
- `got`, `ky`, `node-fetch` and other clients (v1 covers the global and
  axios);
- `globalThis.fetch(…)`.

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Escalate once triaged — SSRFs are rarely intentional:
		"backend-doctor/no-ssrf": "error",
		// or silence it deliberately:
		// "backend-doctor/no-ssrf": "off",
	},
});
```
