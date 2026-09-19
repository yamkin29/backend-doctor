import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/types.js";
import { runScan } from "../../src/core/scan.js";

const BAD_APP = path.resolve(import.meta.dirname, "../fixtures/engine/bad-app");

function rel(result: { input: { directory: string } }, filePath: string) {
	return path
		.relative(result.input.directory, filePath)
		.split(path.sep)
		.join("/");
}

describe("runScan on the bad-app fixture (AC-8)", () => {
	it("returns the expected diagnostics in report order", async () => {
		const result = await runScan({
			directory: BAD_APP,
			ignore: [],
			config: defaultConfig(),
		});

		expect(
			result.diagnostics.map((d) => [
				rel(result, d.filePath),
				d.line,
				d.column,
				d.rule,
				d.message,
			]),
		).toEqual([
			[
				"src/index.ts",
				3,
				15,
				"backend-doctor/no-eval",
				"Prefer safer alternatives instead of eval(); it executes arbitrary code.",
			],
			[
				"src/index.ts",
				4,
				17,
				"backend-doctor/no-new-func",
				"Prefer explicit code instead of new Function(); it compiles arbitrary code at runtime.",
			],
		]);
		expect(result.diagnostics.every((d) => d.severity === "warn")).toBe(true);
	});

	it("fills projects[0] with packageRoot, analyzed files and counts", async () => {
		const result = await runScan({
			directory: BAD_APP,
			ignore: [],
			config: defaultConfig(),
		});

		expect(result.projects).toEqual([
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

	it("honors the ignore globs passed in ScanInput", async () => {
		const result = await runScan({
			directory: BAD_APP,
			ignore: ["src/index.ts"],
			config: defaultConfig(),
		});

		expect(result.diagnostics).toEqual([]);
		expect(result.projects[0]?.analyzedFiles).toEqual(["src/util.ts"]);
	});

	it("applies config severity overrides over rule defaults (AC-5)", async () => {
		const config = defaultConfig();
		config.rules["backend-doctor/no-eval"] = "error";

		const result = await runScan({
			directory: BAD_APP,
			ignore: [],
			config,
		});

		const severities = Object.fromEntries(
			result.diagnostics.map((d) => [d.rule, d.severity]),
		);
		expect(severities).toEqual({
			"backend-doctor/no-eval": "error",
			"backend-doctor/no-new-func": "warn",
		});
	});
});

describe("runScan framework detection (AC-1..8, spec 004)", () => {
	function makeProject(): string {
		return fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-fw-"));
	}

	function writeProjectFile(
		root: string,
		relPath: string,
		content: string,
	): void {
		const file = path.join(root, relPath);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
	}

	it("fills projects[0].frameworks from package.json dependencies", async () => {
		const tmp = makeProject();
		try {
			fs.writeFileSync(
				path.join(tmp, "package.json"),
				JSON.stringify({
					name: "app",
					dependencies: { express: "^4.19.2", lodash: "^4.17.0" },
				}),
			);
			writeProjectFile(tmp, "src/index.ts", "export const x = 1;\n");

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["express"]);
			expect(result.projects[0]?.packageRoot).toBe(tmp);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("detects frameworks from code markers without declared dependencies", async () => {
		const tmp = makeProject();
		try {
			fs.writeFileSync(
				path.join(tmp, "package.json"),
				JSON.stringify({ name: "app" }),
			);
			writeProjectFile(
				tmp,
				"src/main.ts",
				'import { Controller } from "@nestjs/common";\n',
			);

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["nest"]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("detects prisma from the schema file marker", async () => {
		const tmp = makeProject();
		try {
			fs.writeFileSync(
				path.join(tmp, "package.json"),
				JSON.stringify({ name: "app" }),
			);
			writeProjectFile(
				tmp,
				"prisma/schema.prisma",
				"model User { id Int @id }",
			);

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["prisma"]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("reports a malformed package.json via skippedChecks and keeps code markers (AC-8)", async () => {
		const tmp = makeProject();
		try {
			fs.writeFileSync(path.join(tmp, "package.json"), "{ not json");
			writeProjectFile(tmp, "src/main.ts", 'import express from "express";\n');

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["express"]);
			expect(result.projects[0]?.skippedChecks).toEqual([
				{
					check: "framework-detection",
					reason: expect.stringContaining("package.json"),
				},
			]);
			expect(result.projects[0]?.complete).toBe(true);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runScan fail-soft behavior (AC-2, constitution §8)", () => {
	it("records unreadable files in skippedChecks and keeps scanning", async () => {
		const skipRootCheck =
			typeof process.getuid === "function" && process.getuid() === 0;
		if (skipRootCheck) {
			// Root ignores file permissions; the scenario cannot be staged.
			return;
		}

		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-scan-"));
		try {
			fs.cpSync(BAD_APP, tmp, { recursive: true });
			const unreadable = path.join(tmp, "src", "secret.ts");
			fs.writeFileSync(unreadable, "export const secret = 1;\n");
			fs.chmodSync(unreadable, 0o000);

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.complete).toBe(true);
			expect(result.projects[0]?.skippedChecks).toHaveLength(1);
			expect(result.projects[0]?.skippedChecks[0]).toMatchObject({
				check: "read",
				reason: expect.stringContaining("src/secret.ts"),
			});
			expect(result.projects[0]?.analyzedFiles).toEqual([
				"src/index.ts",
				"src/util.ts",
			]);
			expect(result.diagnostics).toHaveLength(2);
		} finally {
			fs.chmodSync(path.join(tmp, "src", "secret.ts"), 0o644);
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runScan async rules (AC-17, spec 005)", () => {
	function writeAsyncProject(): string {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-async-"));
		const src = path.join(tmp, "src");
		fs.mkdirSync(src, { recursive: true });
		fs.writeFileSync(
			path.join(src, "worker.ts"),
			[
				"async function job(): Promise<void> {}",
				"job();",
				'const items = ["a", "b"];',
				"items.forEach(async () => {",
				"\tawait Promise.resolve();",
				"});",
				"function parse(raw: string): unknown {",
				"\treturn JSON.parse(raw);",
				"}",
			].join("\n"),
		);
		return tmp;
	}

	it("reports the three async violations in report order at warn severity", async () => {
		const tmp = writeAsyncProject();
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(
				result.diagnostics.map((d) => [d.line, d.column, d.rule, d.severity]),
			).toEqual([
				[2, 1, "backend-doctor/no-floating-promises", "warn"],
				[4, 1, "backend-doctor/no-async-foreach-callback", "warn"],
				[8, 9, "backend-doctor/unhandled-json-parse", "warn"],
			]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("escalates one rule to error without touching the others", async () => {
		const tmp = writeAsyncProject();
		try {
			const config = defaultConfig();
			config.rules["backend-doctor/no-floating-promises"] = "error";

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config,
			});

			const byRule = Object.fromEntries(
				result.diagnostics.map((d) => [d.rule, d.severity]),
			);
			expect(byRule).toEqual({
				"backend-doctor/no-floating-promises": "error",
				"backend-doctor/no-async-foreach-callback": "warn",
				"backend-doctor/unhandled-json-parse": "warn",
			});
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("suppresses a rule listed in ignore.rules (AC-17 off path)", async () => {
		const tmp = writeAsyncProject();
		try {
			const config = defaultConfig();
			config.ignore.rules = ["backend-doctor/no-floating-promises"];

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config,
			});

			expect(result.diagnostics.map((d) => d.rule)).not.toContain(
				"backend-doctor/no-floating-promises",
			);
			expect(result.diagnostics).toHaveLength(2);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
