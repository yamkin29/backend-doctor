# Security Policy

## Supported versions

Security fixes land on the latest published minor of `backend-doctor-cli`
(0.1.x at the moment). Older versions do not receive backports — upgrade to
the newest release.

## Reporting a vulnerability

Please use **GitHub's private vulnerability reporting** on this repository
(Security → Report a vulnerability). Do not open a public issue for anything
you believe is exploitable.

Useful in a report:

- The `backend-doctor-cli` version and the command line you ran.
- Node.js version and OS.
- A minimal repository tree / input that triggers the problem.

## What counts as a security issue here

backend-doctor reads your code and never executes it, so treat these areas
as the attack surface:

- **The scanner** — a crafted source tree that makes the CLI write outside
  its working directories, execute code, or crash in a way that hides
  findings (constitution: silent suppression is a defect).
- **The runtime probe** (`backend-doctor probe`) — anything that lets an
  instrumented app escape the local-only promise: traces leaving the
  machine, the `--require` hook executing unintended code, `NODE_OPTIONS`
  mishandling.
- **CI surfaces** (`backend-doctor ci report`, the composite action) —
  injection through a crafted scan report or PR context into workflow
  steps, comment bodies, or API calls.
- **Config loading** — a `backend-doctor.config.ts` from an untrusted
  directory executing more than the documented load step.

## What is not a security report

- A rule **misses** a pattern (detection gap) or **flags** correct code
  (false positive) — those are quality issues, please open a regular issue
  (false positives are the highest-priority kind). Rule evasion by clearly
  malicious code is expected: the tool is a linter, not a sandbox.
- Crash-with-exit-code-2 usage errors.

## Disclosure

We will acknowledge reports, work on a fix, and credit you in the release
notes unless you prefer to stay anonymous. Please give us a reasonable
window to publish a fixed version before public disclosure.
