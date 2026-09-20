# backend-doctor/no-committed-env

Flags dotenv files that sit at the package root without `.gitignore`
coverage.

- **Category:** Security
- **Default severity:** `warn`

## Problem

A dotenv file at the package root holds real credentials; without
`.gitignore` coverage it is one `git add .` away from the repository,
and git history keeps it after any later deletion. The same failure
class as `no-hardcoded-secrets`, one directory level up.

## Detection

Project-scope check over a fixed candidate list — the standard dotenv
names at the package root (never their contents; the engine scans
TypeScript sources only):

`.env`, `.env.local`, `.env.development`, `.env.development.local`,
`.env.production`, `.env.production.local`, `.env.test`,
`.env.test.local`

A present candidate is flagged unless the package-root `.gitignore`
covers it. Coverage uses approximate gitignore semantics sufficient for
root-level files: comments and blank lines are skipped; lines match in
order with last-match-wins (git semantics); `!pattern` negation
un-covers; a trailing `/` marks a directory-only pattern and never
matches a file; a leading `/` is stripped; glob lines match via
picomatch with `dot: true` (so `.env.*` covers `.env.production` and
`**/.env` covers a root-level `.env`); any other line matches by exact
basename. When no `.gitignore` exists at the package root, every present
candidate reports. `.env.example`-style names are not candidates — a
committed template is the fix the message asks for.

## Bad

```text
project/
├─ .gitignore          # dist/ , node_modules/  — no .env lines
├─ .env                # real credentials, uncovered
└─ package.json
```

## Good

```text
project/
├─ .gitignore          # .env , .env.*
├─ .env.example        # committed template with empty values
└─ package.json
```

## Scope notes (precision over recall, constitution §2)

Not flagged / known limits:

- content is never read — a committed `.env` with only harmless keys is
  still flagged (presence-based check);
- only the package-root `.gitignore` is consulted: nested `.gitignore`
  files, `.git/info/exclude`, global git excludes and repo-root
  coverage of a nested package root (monorepos) are out of reach — a
  documented recall hole;
- a `git check-ignore` subprocess was rejected on purpose: the engine
  stays a deterministic local process with no environment dependence;
- the file being present-but-untracked still flags — the rule states
  the risk ("not covered by .gitignore"), not the fact of a commit.

## Configuration

```ts
import { defineConfig } from "backend-doctor";

export default defineConfig({
	rules: {
		// Treat uncovered dotenv files as build-breakers:
		"backend-doctor/no-committed-env": "error",
		// or silence it deliberately:
		// "backend-doctor/no-committed-env": "off",
	},
});
```
