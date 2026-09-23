## What

<!-- One paragraph: the change and its motivation. Link the issue or the
     spec (docs/specs/NNN-*/) it implements. -->

## Tests

<!-- Every acceptance criterion of the change has a test. List them or
     point at the test file. -->

## Verification

- [ ] `pnpm test` green
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm format` applied, `pnpm lint` clean
- [ ] rule docs updated (`pnpm docs:rules` green) — if a rule changed

## Stability (constitution §5)

- [ ] CLI exit codes, report `schemaVersion`, config file names and shipped
      rule ids are untouched — or the breaking change is explicitly
      discussed in this PR
- [ ] new dependencies are justified
