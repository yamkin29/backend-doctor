# backend-doctor/no-long-running-transaction

Reports external I/O and delays inside an interactive `$transaction`
callback — row locks held while the transaction waits.

- **Category:** Performance
- **Default severity:** `warn`

## Problem

An interactive transaction (`prisma.$transaction(async (tx) => { … })`)
opens a database transaction and holds its locks until the callback
returns. Wait on an HTTP call or a timer inside that callback and every
other writer of the touched rows queues behind a network round-trip;
connection-pool slots pile up, lock timeouts surface as flaky 500s, and the
transaction's `timeout` (default 5s) kills work that would otherwise have
succeeded. Fetch what you need first, then transact over the Prisma
statements only.

## Bad

```ts
// ❌ locks held across an HTTP round-trip
await prisma.$transaction(async () => {
	const profile = await fetch(profileUrl);
	await prisma.user.create({ data: { profile } });
});

// ❌ the sleep idiom — the transaction waits out the timer
await prisma.$transaction(async () => {
	await new Promise((resolve) => setTimeout(resolve, 500));
	await prisma.user.create({ data: {} });
});
```

## Good

```ts
// ✅ external I/O before the transaction
const profile = await fetch(profileUrl);
await prisma.$transaction(async () => {
	await prisma.user.create({ data: { profile } });
});
```

## Scope notes (precision over recall, constitution §2)

- Only the interactive (callback) form is inspected; the array form
  `$transaction([a, b])` is a fixed batch and never matches.
- Vocabulary: awaited bare `fetch`, awaited member calls on an
  `axios`-rooted receiver (`get`/`post`/`put`/`patch`/`delete`/`request`),
  and `setTimeout`/`setInterval` anywhere in the callback (containment does
  not stop at function boundaries — a timer inside a `new Promise` executor
  still delays the transaction).
- Unawaited `fetch`/axios calls do not make the transaction wait and are
  reported by `no-floating-promises` instead — no call is reported twice.
- Documented recall holes: Nest `HttpService` (`this.http.get`),
  `sleep()`-style user helpers, other HTTP clients, and external I/O in
  nested callbacks other than timer executors. The rule runs only when the
  `prisma` framework is detected.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		"backend-doctor/no-long-running-transaction": "error",
		// or silence it deliberately:
		// "backend-doctor/no-long-running-transaction": "off",
	},
});
```
