import { describe, expect, it } from "vitest";
import { makeTmpDir, runCli } from "./helpers.js";

describe("scope flag validation (spec 015 AC-8)", () => {
	it("exits 2 when --scope files has no --file", () => {
		const dir = makeTmpDir();
		const result = runCli(["scan", dir, "--scope", "files"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("--file");
		expect(result.stdout).toBe("");
	});

	it("exits 2 when --file is used without --scope files", () => {
		const dir = makeTmpDir();
		const result = runCli(["scan", dir, "--file", "src/a.ts"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("--scope files");
		expect(result.stdout).toBe("");
	});

	it("exits 2 for an unknown --scope value", () => {
		const dir = makeTmpDir();
		const result = runCli(["scan", dir, "--scope", "bogus"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).not.toBe("");
		expect(result.stdout).toBe("");
	});
});
