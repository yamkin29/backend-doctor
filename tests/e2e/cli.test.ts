import { describe, expect, it } from "vitest";
import {
	expectSuccess,
	makeTmpDir,
	packageVersion,
	runCli,
} from "./helpers.js";

describe("AC-1: --version", () => {
	it("prints the package version to stdout and exits 0", () => {
		const result = runCli(["--version"]);
		expectSuccess(result);
		expect(result.stdout.trim()).toBe(packageVersion());
	});

	it("supports the -V short flag", () => {
		const result = runCli(["-V"]);
		expectSuccess(result);
		expect(result.stdout.trim()).toBe(packageVersion());
	});
});

describe("AC-2: pretty empty scan", () => {
	it("prints the scanned directory and a zero-issue summary, exits 0", () => {
		const dir = makeTmpDir();
		const result = runCli(["scan", dir]);
		expectSuccess(result);
		expect(result.stdout).toContain(dir);
		expect(result.stdout).toContain("0 issues");
	});
});

describe("AC-3: json report", () => {
	it("prints exactly one schemaVersion-1 document to stdout, exits 0", () => {
		const dir = makeTmpDir();
		const result = runCli(["scan", dir, "--format", "json"]);
		expectSuccess(result);
		const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(Object.keys(parsed).sort()).toEqual(
			["diagnostics", "directory", "mode", "projects", "schemaVersion"].sort(),
		);
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.mode).toBe("full");
		expect(parsed.directory).toBe(dir);
		expect(parsed.diagnostics).toEqual([]);
		expect(parsed.projects).toEqual([]);
	});
});

describe("AC-4: jsonl empty scan", () => {
	it("prints nothing to stdout and exits 0", () => {
		const dir = makeTmpDir();
		const result = runCli(["scan", dir, "--format", "jsonl"]);
		expectSuccess(result);
		expect(result.stdout).toBe("");
	});
});
