# backend-doctor/no-command-injection

Flags dynamically built shell commands — `exec`/`execSync` from
`child_process` with anything but a literal command string.

- **Category:** Security
- **Default severity:** `warn`

## Problem

`exec` and `execSync` run their argument through a shell. When any part of
the command is derived from request data (a path segment, a query parameter,
a header), an attacker can append shell metacharacters (`;`, `$(…)`, `` `…` ``
`&&`) and execute arbitrary commands as the service user. The argument-array
APIs do not invoke a shell and are the fix. Module top level is **not**
exempt: an injection path does not become safe at startup.

The rule is a heuristic — a call to `exec`/`execSync` whose first argument is
not a string literal is flagged; whether the value is actually attacker-
controlled is not resolved statically.

## Bad

```ts
import { exec } from "node:child_process";

// ❌ request data becomes shell input
export function removeFile(req: { params: { name: string } }): void {
	exec(`rm /tmp/uploads/${req.params.name}`);
}
```

## Good

```ts
import { unlink } from "node:fs/promises";

// ✅ no shell involved; the exact file is removed
export async function removeFile(req: { params: { name: string } }): Promise<void> {
	await unlink(`/tmp/uploads/${req.params.name}`);
}
```

When a shell is genuinely required, pass an argument array so the shell
never interprets the user data:

```ts
import { execFile } from "node:child_process";

// ✅ arguments are passed verbatim, no shell parsing
export function convert(req: { params: { id: string } }): void {
	execFile("convert", ["/tmp/in.png", `/tmp/out-${req.params.id}.png`]);
}
```

## Scope notes (precision over recall, constitution §2)

Always flagged (in files referencing `child_process`/`node:child_process`):
`exec`/`execSync`, property form on any receiver plus bare named imports
(same-file declarations and own-class members shadow the name and suppress
the finding, spec 006 precedent). A spread-only argument list
(`exec(...args)`) is indistinguishable from the dynamic form and is flagged.

Not flagged (documented recall holes):

- `spawn`/`spawnSync`/`execFile`/`fork` — they do not invoke a shell by
  default (this is the rule's suggested fix, not an omission);
- aliased or re-exported `exec` bindings; the module gate does not resolve
  cross-file imports;
- files that reach `exec` without referencing the module specifier.

`spawn(cmd, args, { shell: true })` is a real injection shape and is not
detected in v1 (spec 007 open question 5) — revisit after the eval corpus
(F022).

## Configuration

```ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Most teams treat this as a build-breaker:
		"backend-doctor/no-command-injection": "error",
		// or silence it deliberately:
		// "backend-doctor/no-command-injection": "off",
	},
});
```
