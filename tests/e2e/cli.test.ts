import os from "node:os";
import path from "node:path";
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
		// F003 fills projects[]; an empty directory yields one empty project.
		expect(parsed.projects).toEqual([
			{
				packageRoot: dir,
				frameworks: [],
				analyzedFiles: [],
				analyzedFileCount: 0,
				complete: true,
				skippedChecks: [],
			},
		]);
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

describe("AC-5: unknown option", () => {
	it("prints usage to stderr and exits 2", () => {
		const result = runCli(["scan", makeTmpDir(), "--bogus"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).not.toBe("");
	});
});

// F002 made --config functional (spec 002, AC-2); the F001 "reserved" contract
// evolved accordingly: a missing explicit config file now exits 2 naming it.
describe("AC-6: --config with a missing file", () => {
	it("exits 2 and names the missing path", () => {
		const missing = path.join(
			os.tmpdir(),
			`bd-missing-config-${process.pid}-${Date.now()}.ts`,
		);
		const result = runCli(["scan", makeTmpDir(), "--config", missing]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain(missing);
	});
});

describe("AC-7: nonexistent path", () => {
	it("exits 2 with a message naming the path", () => {
		const missing = path.join(
			os.tmpdir(),
			`backend-doctor-missing-${process.pid}-${Date.now()}`,
		);
		const result = runCli(["scan", missing]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain(missing);
	});
});

describe("AC-8: invalid --format value", () => {
	it("exits 2 for an unsupported format", () => {
		const result = runCli(["scan", makeTmpDir(), "--format", "xml"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).not.toBe("");
	});
});
