# Design 001 — CLI skeleton & DX (F001)

- **Status:** Draft — pending spec review
- **Implements:** [spec.md](./spec.md)

## Package shape

Single npm package `backend-doctor`, bin `backend-doctor` → `./dist/bin/backend-doctor.js`
(tsup adds the shebang). No monorepo (PLAN §3).

```
src/
├─ bin/backend-doctor.ts     # shebang entry: calls run(), sets process.exitCode
├─ cli/
│  ├─ run.ts                 # run(argv): number — parse & dispatch, side-effect free
│  └─ commands/scan.ts       # scan command implementation
├─ core/
│  ├─ scan.ts                # pipeline stub: ScanInput → ScanResult (0 rules in F001)
│  └─ report.ts              # builds the v1 report document
└─ reporters/
   ├─ types.ts               # Reporter interface + ReportDocument types
   ├─ pretty.ts
   ├─ json.ts
   └─ jsonl.ts
```

## Dependencies

- Runtime: `commander` (argument parsing), `picocolors` (pretty colors, TTY-aware).
- Dev: `typescript`, `tsup`, `vitest`, `@biomejs/biome`, `tsx` (not required at
  runtime), `@types/node`.

## Key decisions

1. **`run(argv) → number`, no `process.exit` in the core.** The bin entry sets
   `process.exitCode = run(process.argv)`. This keeps the CLI testable in-process and
   lets stdout flush naturally. Commander's default `process.exit` behavior is disabled
   with `exitOverride`, converting parse errors into our exit code 2 (AC-5/6/8).
2. **Report building is separate from rendering.** `core/report.ts` produces the
   `ReportDocument` (the JSON schema v1 shape); reporters render it. `json` is a
   `JSON.stringify` of the document; `jsonl` maps diagnostics; `pretty` is the only
   format allowed to deviate from the document shape.
3. **Pipeline stub in F001.** `core/scan.ts` returns a `ScanResult` with zero
   diagnostics and zero projects, but already owns the `ScanInput → ScanResult` shape
   (directory, ignore globs). F003 fills the middle without touching CLI code.
4. **Exit code policy lives in one place** (`core/exit-code.ts`): `1` iff any
   diagnostic has `severity === "error"`, else `0`; usage errors short-circuit to `2`
   in `run()`.
5. **Path resolution:** `scan` resolves its path argument (or cwd) to an absolute path
   immediately and validates existence with `fs.existsSync` (AC-7). Symlink/realpath
   normalization is deferred to F003.
6. **Testing without npm install of self:** vitest `globalSetup` runs `tsup` once; e2e
   tests spawn `node dist/bin/backend-doctor.js`. Unit tests import `run()` and the
   reporters directly.

## Version pinning

Node `>=20`, `engines` enforced. Exact minor pins for runtime deps at F001; renovate/
updates later.

## Test map (AC → test)

| AC | Test |
|----|------|
| AC-1 | e2e: `--version` matches `package.json` version, exit 0 |
| AC-2 | e2e: `scan <empty tmp dir>`, pretty output contains dir + "0 issues", exit 0 |
| AC-3 | e2e + unit: `--format json` parses, `schemaVersion === 1`, exact keys |
| AC-4 | e2e: `--format jsonl`, stdout is empty, exit 0 |
| AC-5 | e2e: unknown flag, stderr non-empty, exit 2 |
| AC-6 | e2e: `--config x`, exit 2, message mentions F002 |
| AC-7 | e2e: `scan /nonexistent-…`, exit 2, message contains the path |
| AC-8 | e2e: `--format xml`, exit 2 |
| AC-9 | asserted by the shared e2e helper on every case above |
| AC-10 | `.github/workflows/ci.yml`: lint + test on push/PR |
