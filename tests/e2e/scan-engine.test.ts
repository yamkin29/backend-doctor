import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

const BAD_APP = path.resolve(import.meta.dirname, "../fixtures/engine/bad-app");

describe("e2e: scan against the bad-app fixture (AC-7)", () => {
	it("pretty report contains relative paths and rule ids, exits 0 on warn", () => {
		const result = runCli(["scan", BAD_APP]);
		expectSuccess(result, 0);

		expect(result.stdout).toContain("src/index.ts:3:15");
		expect(result.stdout).toContain("backend-doctor/no-eval");
		expect(result.stdout).toContain("src/index.ts:4:17");
		expect(result.stdout).toContain("backend-doctor/no-new-func");
		// + the graph findings on the unreachable util.ts (spec 013).
		expect(result.stdout).toContain("4 warnings");
	});

	it("json report carries diagnostics[] and the projects[] shape (AC-8)", () => {
		const result = runCli(["scan", BAD_APP, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<Record<string, unknown>>;
			projects: Array<Record<string, unknown>>;
		};

		expect(doc.diagnostics).toHaveLength(4);
		for (const d of doc.diagnostics) {
			expect(Object.keys(d).sort()).toEqual(
				[
					"category",
					"column",
					"filePath",
					"id",
					"line",
					"message",
					"rule",
					"severity",
					"tags",
				].sort(),
			);
			expect(d.id).toMatch(/::[0-9a-f]{8}$/);
		}
		expect(doc.diagnostics.map((d) => d.rule)).toEqual([
			"backend-doctor/no-eval",
			"backend-doctor/no-new-func",
			// The graph findings on the unreachable util.ts (spec 013).
			"backend-doctor/unused-export",
			"backend-doctor/unused-file",
		]);

		expect(doc.projects).toEqual([
			{
				packageRoot: BAD_APP,
				frameworks: [],
				analyzedFiles: ["src/index.ts", "src/util.ts"],
				analyzedFileCount: 2,
				complete: true,
				skippedChecks: [],
			},
		]);
	});

	it("jsonl prints one diagnostic per line", () => {
		const result = runCli(["scan", BAD_APP, "--format", "jsonl"]);
		expectSuccess(result, 0);

		const lines = result.stdout.trimEnd().split("\n");
		expect(lines).toHaveLength(4);
		const parsed = lines.map((line) => JSON.parse(line) as { rule: string });
		expect(parsed.map((d) => d.rule)).toEqual([
			"backend-doctor/no-eval",
			"backend-doctor/no-new-func",
			"backend-doctor/unused-export",
			"backend-doctor/unused-file",
		]);
	});

	it("escalating no-eval to error in config flips the exit code to 1", () => {
		const dir = makeTmpDir();
		const configPath = path.join(dir, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({ rules: { "backend-doctor/no-eval": "error" } }),
		);

		const result = runCli([
			"scan",
			BAD_APP,
			"--format",
			"json",
			"--config",
			configPath,
		]);
		expectSuccess(result, 1);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<{ rule: string; severity: string }>;
		};
		expect(
			doc.diagnostics.find((d) => d.rule === "backend-doctor/no-eval")
				?.severity,
		).toBe("error");
		expect(
			doc.diagnostics.find((d) => d.rule === "backend-doctor/no-new-func")
				?.severity,
		).toBe("warn");
	});
});

describe("e2e: determinism (AC-10)", () => {
	it("two consecutive json scans are byte-identical", () => {
		const first = runCli(["scan", BAD_APP, "--format", "json"]);
		const second = runCli(["scan", BAD_APP, "--format", "json"]);

		expectSuccess(first, 0);
		expectSuccess(second, 0);
		expect(second.stdout).toBe(first.stdout);
		expect(first.stdout.length).toBeGreaterThan(0);
	});
});

describe("e2e: ignore globs cut the scan target", () => {
	it("a CLI --ignore suppresses matching files", () => {
		const result = runCli([
			"scan",
			BAD_APP,
			"--format",
			"json",
			"--ignore",
			"src/index.ts",
		]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: unknown[];
			projects: Array<{ analyzedFiles: string[] }>;
		};
		expect(doc.diagnostics).toEqual([]);
		expect(doc.projects[0]?.analyzedFiles).toEqual(["src/util.ts"]);
	});
});

describe("e2e: skipped checks stay visible (AC-2)", () => {
	it("an unreadable file lands in projects[].skippedChecks", () => {
		if (typeof process.getuid === "function" && process.getuid() === 0) {
			return; // Root ignores file permissions; scenario cannot be staged.
		}

		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-e2e-"));
		try {
			fs.cpSync(BAD_APP, tmp, { recursive: true });
			const unreadable = path.join(tmp, "src", "secret.ts");
			fs.writeFileSync(unreadable, "export const secret = 1;\n");
			fs.chmodSync(unreadable, 0o000);

			const result = runCli(["scan", tmp, "--format", "json"]);
			expectSuccess(result, 0);

			const doc = JSON.parse(result.stdout) as {
				projects: Array<{
					complete: boolean;
					skippedChecks: Array<{ check: string; reason: string }>;
				}>;
			};
			expect(doc.projects[0]?.complete).toBe(true);
			expect(doc.projects[0]?.skippedChecks).toEqual([
				{
					check: "read",
					reason: expect.stringContaining("src/secret.ts"),
				},
			]);
		} finally {
			fs.chmodSync(path.join(tmp, "src", "secret.ts"), 0o644);
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
