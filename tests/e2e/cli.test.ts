import { describe, expect, it } from "vitest";
import { expectSuccess, packageVersion, runCli } from "./helpers.js";

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
