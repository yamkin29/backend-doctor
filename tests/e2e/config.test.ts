import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

function writeConfig(dir: string, name: string, content: string): string {
	const file = path.join(dir, name);
	fs.writeFileSync(file, content);
	return file;
}

describe("AC-10: a valid config does not change scan behavior", () => {
	it("scans normally when a config file is discovered", () => {
		const proj = makeTmpDir();
		writeConfig(proj, "backend-doctor.config.ts", "export default {};");
		const result = runCli(["scan", proj]);
		expectSuccess(result);
		expect(result.stdout).toContain(proj);
		expect(result.stdout).toContain("0 issues");
	});
});

describe("AC-11: --dump-config", () => {
	it("prints the resolved config with source and unioned ignores, exits 0", () => {
		const proj = makeTmpDir();
		const configPath = writeConfig(
			proj,
			"backend-doctor.config.json",
			JSON.stringify({ ignore: { files: ["dist/**"] } }),
		);

		const result = runCli([
			"scan",
			proj,
			"--dump-config",
			"--ignore",
			"coverage/**",
		]);

		expectSuccess(result);
		const parsed = JSON.parse(result.stdout) as {
			rules: Record<string, never>;
			categories: Record<string, never>;
			ignore: { files: string[]; rules: string[] };
			source: { kind: string; path: string | null };
		};
		expect(parsed.source).toEqual({ kind: "file", path: configPath });
		expect(parsed.ignore.files).toEqual(["dist/**", "coverage/**"]);
		expect(parsed.rules).toEqual({});
		expect(parsed.ignore.rules).toEqual([]);
		// dump only — no scan output on stdout
		expect(result.stdout).not.toContain("Summary");
	});

	it("reports defaults when no config is found", () => {
		const proj = makeTmpDir();
		const result = runCli(["scan", proj, "--dump-config"]);
		expectSuccess(result);
		const parsed = JSON.parse(result.stdout) as {
			source: { kind: string; path: string | null };
		};
		expect(parsed.source).toEqual({ kind: "default", path: null });
	});
});

describe("AC-13: config errors exit 2 with stdout clean", () => {
	it("rejects an invalid severity, naming the field path", () => {
		const proj = makeTmpDir();
		writeConfig(
			proj,
			"backend-doctor.config.json",
			JSON.stringify({ categories: { Bugs: "fatal" } }),
		);
		const result = runCli(["scan", proj]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain('categories["Bugs"]');
		expect(result.stdout).toBe("");
	});

	it("rejects unknown rule ids", () => {
		const proj = makeTmpDir();
		writeConfig(
			proj,
			"backend-doctor.config.json",
			JSON.stringify({ rules: { "backend-doctor/ghost": "off" } }),
		);
		const result = runCli(["scan", proj]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown rule id");
		expect(result.stderr).toContain("backend-doctor/ghost");
		expect(result.stdout).toBe("");
	});

	it("rejects a config module without default or config export, naming the file", () => {
		const proj = makeTmpDir();
		writeConfig(
			proj,
			"backend-doctor.config.ts",
			"export const something = 1;",
		);
		const result = runCli(["scan", proj]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("backend-doctor.config.ts");
		expect(result.stdout).toBe("");
	});

	it("rejects invalid JSON configs", () => {
		const proj = makeTmpDir();
		writeConfig(proj, "backend-doctor.config.json", "{ not json");
		const result = runCli(["scan", proj]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("invalid JSON");
		expect(result.stdout).toBe("");
	});
});
