import { describe, expect, it } from "vitest";
import {
	DEFAULT_ACTION_REF,
	renderWorkflowTemplate,
} from "../../../src/ci/workflow-template.js";

describe("renderWorkflowTemplate", () => {
	it("renders the PR trigger types", () => {
		const yaml = renderWorkflowTemplate(DEFAULT_ACTION_REF);
		expect(yaml).toContain("pull_request:");
		expect(yaml).toContain("types: [opened, synchronize, reopened]");
	});

	it("declares the four required permissions", () => {
		const yaml = renderWorkflowTemplate(DEFAULT_ACTION_REF);
		expect(yaml).toContain("permissions:");
		expect(yaml).toContain("  contents: read");
		expect(yaml).toContain("  issues: write");
		expect(yaml).toContain("  pull-requests: write");
		expect(yaml).toContain("  statuses: write");
	});

	it("declares the concurrency group with cancellation", () => {
		const yaml = renderWorkflowTemplate(DEFAULT_ACTION_REF);
		expect(yaml).toContain("concurrency:");
		expect(yaml).toContain(
			`group: backend-doctor-\${{ github.event.pull_request.number || github.ref }}`,
		);
		expect(yaml).toContain("cancel-in-progress: true");
	});

	it("checks out with full history for merge-base diffs", () => {
		const yaml = renderWorkflowTemplate(DEFAULT_ACTION_REF);
		expect(yaml).toContain("actions/checkout@v4");
		expect(yaml).toContain("fetch-depth: 0");
	});

	it("bakes the default action ref into the uses line", () => {
		const yaml = renderWorkflowTemplate(DEFAULT_ACTION_REF);
		expect(yaml).toContain(`uses: ${DEFAULT_ACTION_REF}`);
	});

	it("substitutes a custom action ref verbatim", () => {
		const yaml = renderWorkflowTemplate("someone/else@main");
		expect(yaml).toContain("uses: someone/else@main");
		expect(yaml).not.toContain(DEFAULT_ACTION_REF);
	});

	it("renders GitHub expressions literally", () => {
		const yaml = renderWorkflowTemplate(DEFAULT_ACTION_REF);
		expect(yaml).toContain(
			`\${{ github.event.pull_request.number || github.ref }}`,
		);
	});

	it("is deterministic: two renders are byte-identical", () => {
		expect(renderWorkflowTemplate(DEFAULT_ACTION_REF)).toBe(
			renderWorkflowTemplate(DEFAULT_ACTION_REF),
		);
	});
});
