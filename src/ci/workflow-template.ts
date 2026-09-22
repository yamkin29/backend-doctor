/**
 * The workflow `ci install` writes. Byte-deterministic by construction: a
 * fixed template with a single substitution (the action ref), no timestamps
 * and no environment-derived content.
 */

/**
 * The composite action reference baked in unless `--action-ref` overrides
 * it (spec 016 open question 1 — post-rename coordinates of this
 * repository on GitHub).
 */
export const DEFAULT_ACTION_REF = "yamkin29/backend-doctor@v1";

/**
 * Renders the generated workflow. `${{` is escaped below so GitHub's
 * expression syntax survives the TypeScript template literal verbatim.
 */
export function renderWorkflowTemplate(actionRef: string): string {
	return `name: Backend Doctor

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  issues: write
  pull-requests: write
  statuses: write

concurrency:
  group: backend-doctor-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  backend-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: ${actionRef}
`;
}
