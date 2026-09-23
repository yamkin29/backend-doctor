# Tasks 024 — Agent skill installer (F024)

TDD order: the pure core first (unit tests over temp trees with injected
roots), then the CLI wiring (e2e through the bin), then docs, then close-out.

## Tasks

- [ ] **T1. Installer core (AC-1..AC-4, AC-6..AC-8).** RED:
  `tests/unit/cli/install-command.test.ts` — fresh project install, up-to-date
  no-op, drift refusal + `--force` clean replace, detection report (snapshot +
  no-write tree fingerprint), global scope with injected home, missing source
  fails loud, deterministic stdout. GREEN: `src/cli/commands/install.ts` —
  target table, `import.meta.url` source resolver, folder equality, recursive
  copy, report; `installCommand(opts, roots)` with defaults from
  `process.cwd()`/`os.homedir()`/the package itself.
- [ ] **T2. CLI wiring (AC-1..AC-6 e2e).** RED:
  `tests/e2e/install-command.test.ts` — through the built bin with isolated
  `cwd`/`HOME`: happy path, up-to-date, drift + `--force`, detection, unknown
  agent (exit 2, choices on stderr), global scope. GREEN: `install` command in
  `src/cli/run.ts` with `.choices()` validation.
- [ ] **T3. README (agents section).** No TDD — docs; command correctness is
  covered by T1/T2, live execution recorded in T5. `backend-doctor install`
  becomes the primary path with the manual `cp` as fallback.
- [ ] **T4. Version 0.1.2.** No TDD — release config for the next publish.
- [ ] **T5. Live verification.** Run the `prepublishOnly` chain; execute the
  README agents-section commands verbatim (install variants against isolated
  HOME/cwd); record outputs below.
- [ ] **T6. Close-out.** Check boxes; record deviations; spec status →
  `Implemented`; `docs/PLAN.md` F024 → `Done`. User publishes 0.1.2.

## Deviations & notes

- (none yet)

## T5 — recorded outputs

- (pending)
