---
name: Rule proposal
about: Propose a new check for a real-world backend problem
labels:
  - rule-proposal
---

**What it flags (one sentence)**

<!-- e.g. "A synchronous fs call inside a request handler blocks the event loop." -->

**Why it matters in production**

<!-- The incident or class of bugs this prevents. -->

**Bad example**

```ts
// ❌ the offending pattern
```

**Good example**

```ts
// ✅ the corrected pattern
```

**False-positive risk**

<!-- When is this pattern legitimate? A rule ships only with zero
     diagnostics on the clean eval corpus. -->

**Category**

<!-- One of: Bugs, Correctness, Performance, Security, Architecture,
     Maintainability, Configuration, Runtime. -->
