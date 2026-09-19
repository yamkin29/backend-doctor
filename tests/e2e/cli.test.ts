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
