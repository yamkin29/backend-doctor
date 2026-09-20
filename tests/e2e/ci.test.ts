import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ACTION_REF } from "../../src/ci/workflow-template.js";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

const WORKFLOW_REL = path.join(".github", "workflows", "backend-doctor.yml");

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

describe("ci install (AC-1..AC-3)", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = makeTmpDir();
	});
	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	function workflowPath(): string {
		return path.join(tmp, WORKFLOW_REL);
	}

	it("creates the workflow deterministically (AC-1, AC-3 default ref)", () => {
		const result = runCli(["ci", "install"], { cwd: tmp });
		expectSuccess(result);
		expect(result.stdout).toContain(workflowPath());
		const content = fs.readFileSync(workflowPath(), "utf8");
		expect(content).toContain("types: [opened, synchronize, reopened]");
		expect(content).toContain("  contents: read");
		expect(content).toContain("  issues: write");
		expect(content).toContain("  pull-requests: write");
		expect(content).toContain("  statuses: write");
		expect(content).toContain("cancel-in-progress: true");
		expect(content).toContain("fetch-depth: 0");
		expect(content).toContain(`uses: ${DEFAULT_ACTION_REF}`);
	});

	it("is byte-identical across fresh installs (AC-1)", () => {
		runCli(["ci", "install"], { cwd: tmp });
		const other = makeTmpDir();
		try {
			runCli(["ci", "install"], { cwd: other });
			expect(fs.readFileSync(workflowPath(), "utf8")).toBe(
				fs.readFileSync(path.join(other, WORKFLOW_REL), "utf8"),
			);
		} finally {
			fs.rmSync(other, { recursive: true, force: true });
		}
	});

	it("refuses to overwrite an existing workflow without --force (AC-2)", () => {
		runCli(["ci", "install"], { cwd: tmp });
		const before = fs.readFileSync(workflowPath(), "utf8");
		fs.writeFileSync(workflowPath(), "# hand-edited\n");
		const result = runCli(["ci", "install"], { cwd: tmp });
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain(workflowPath());
		expect(result.stdout).toBe("");
		expect(fs.readFileSync(workflowPath(), "utf8")).toBe("# hand-edited\n");
		expect(before).not.toBe("# hand-edited\n");
	});

	it("overwrites with --force (AC-2)", () => {
		runCli(["ci", "install"], { cwd: tmp });
		fs.writeFileSync(workflowPath(), "# hand-edited\n");
		const result = runCli(["ci", "install", "--force"], { cwd: tmp });
		expectSuccess(result);
		expect(fs.readFileSync(workflowPath(), "utf8")).not.toContain(
			"# hand-edited",
		);
	});

	it("bakes a custom --action-ref verbatim (AC-3)", () => {
		const result = runCli(
			["ci", "install", "--action-ref", "someone/else@main"],
			{ cwd: tmp },
		);
		expectSuccess(result);
		expect(fs.readFileSync(workflowPath(), "utf8")).toContain(
			"uses: someone/else@main",
		);
	});
});

describe("action.yml static contract (AC-4)", () => {
	const actionYml = fs.readFileSync(path.join(REPO_ROOT, "action.yml"), "utf8");

	it("is a composite action declaring the eight spec inputs", () => {
		expect(actionYml).toContain("using: composite");
		for (const input of [
			"blocking:",
			"base:",
			"directory:",
			"comment:",
			"review-comments:",
			"commit-status:",
			"review-comments-max:",
			"version:",
		]) {
			expect(actionYml).toContain(input);
		}
	});

	it("carries the spec defaults", () => {
		expect(actionYml).toContain('default: "none"');
		expect(actionYml).toContain('default: "."');
		expect(actionYml).toContain('default: "true"');
		expect(actionYml).toContain('default: "50"');
		expect(actionYml).toContain('default: "latest"');
	});

	it("runs the scan with lines scope and json format into the report file", () => {
		expect(actionYml).toContain("--scope lines");
		expect(actionYml).toContain("--base");
		expect(actionYml).toContain("--format json");
		expect(actionYml).toContain("backend-doctor-report.json");
	});

	it("hands the report to ci report with GITHUB_TOKEN", () => {
		expect(actionYml).toContain("ci report");
		expect(actionYml).toContain("GITHUB_TOKEN:");
	});
});
