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
			// Graph findings (spec 013): nothing reaches util.ts, so its
			// export is dead too — true positives of the fixture tree.
			[
				"src/util.ts",
				1,
				1,
				"backend-doctor/unused-export",
				"add is exported here but no other file imports it; it is public API nobody uses. Remove the export keyword, inline the code, or delete it.",
			],
			[
				"src/util.ts",
				1,
				1,
				"backend-doctor/unused-file",
				"No entry point reaches this file through imports; it is compiled and maintained but never runs. Delete it, expose it through an entry, or import it where it is meant to be used.",
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
			"backend-doctor/unused-export": "warn",
			"backend-doctor/unused-file": "warn",
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
				{
					check: "package-surface",
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
			// no-eval, no-new-func + the graph findings on the unreachable
			// util.ts (spec 013).
			expect(result.diagnostics).toHaveLength(4);
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

describe("runScan blocking rules (AC-10, spec 006)", () => {
	function writeBlockingProject(): string {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "backend-doctor-blocking-"),
		);
		const src = path.join(tmp, "src");
		fs.mkdirSync(src, { recursive: true });
		fs.writeFileSync(
			path.join(src, "worker.ts"),
			[
				'import fs from "node:fs";',
				'import { pbkdf2Sync } from "node:crypto";',
				"",
				"export function load(path: string): string {",
				'\treturn fs.readFileSync(path, "utf8");',
				"}",
				"",
				"export function derive(password: string, salt: string): Buffer {",
				'\treturn pbkdf2Sync(password, salt, 100_000, 32, "sha256");',
				"}",
				"",
				"export function spin(): number {",
				"\tlet total = 0;",
				"\tfor (let i = 0; i < 100_000; i++) {",
				"\t\ttotal += i;",
				"\t}",
				"\treturn total;",
				"}",
			].join("\n"),
		);
		return tmp;
	}

	it("reports the three blocking violations in report order at warn severity", async () => {
		const tmp = writeBlockingProject();
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(
				result.diagnostics.map((d) => [d.line, d.column, d.rule, d.severity]),
			).toEqual([
				[5, 9, "backend-doctor/no-sync-fs-in-request-path", "warn"],
				[9, 9, "backend-doctor/no-sync-crypto", "warn"],
				[14, 2, "backend-doctor/no-cpu-bound-loop", "warn"],
			]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("escalates one blocking rule to error without touching the others", async () => {
		const tmp = writeBlockingProject();
		try {
			const config = defaultConfig();
			config.rules["backend-doctor/no-sync-fs-in-request-path"] = "error";

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config,
			});

			const byRule = Object.fromEntries(
				result.diagnostics.map((d) => [d.rule, d.severity]),
			);
			expect(byRule).toEqual({
				"backend-doctor/no-sync-fs-in-request-path": "error",
				"backend-doctor/no-sync-crypto": "warn",
				"backend-doctor/no-cpu-bound-loop": "warn",
			});
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runScan security rules (AC-14, spec 007)", () => {
	function writeSecurityProject(): string {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "backend-doctor-security-"),
		);
		const src = path.join(tmp, "src");
		fs.mkdirSync(src, { recursive: true });
		fs.writeFileSync(
			path.join(src, "api.ts"),
			[
				'import { exec } from "node:child_process";',
				'import path from "node:path";',
				'import { createHash } from "node:crypto";',
				'import axios from "axios";',
				'import _ from "lodash";',
				"",
				'const apiKey = "sk_live_9fK3pXwR7vTqzLm5Yh8Cd1BnJ2";',
				"",
				"export async function handle(req: {",
				"\tbody: Record<string, string>;",
				"\tparams: { file: string };",
				"\tquery: { url: string };",
				"}): Promise<unknown> {",
				'\tconst file = path.join("/uploads", req.params.file);',
				// biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the staged input
				"\tconst listing = exec(`ls ${file}`);",
				'\tconst digest = createHash("md5").update(listing).digest("hex");',
				"\tconst body = Object.assign({}, req.body);",
				"\tconst response = await axios.get(req.query.url);",
				"\treturn { file, listing, digest, body, response };",
				"}",
			].join("\n"),
		);
		return tmp;
	}

	it("reports the six security violations in report order at warn severity", async () => {
		const tmp = writeSecurityProject();
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(
				result.diagnostics.map((d) => [d.line, d.column, d.rule, d.severity]),
			).toEqual([
				[7, 7, "backend-doctor/no-hardcoded-secrets", "warn"],
				[14, 15, "backend-doctor/no-path-traversal", "warn"],
				[15, 18, "backend-doctor/no-command-injection", "warn"],
				[16, 17, "backend-doctor/no-weak-crypto", "warn"],
				[17, 15, "backend-doctor/no-unsafe-merge", "warn"],
				[18, 25, "backend-doctor/no-ssrf", "warn"],
			]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("escalates one security rule to error without touching the others", async () => {
		const tmp = writeSecurityProject();
		try {
			const config = defaultConfig();
			config.rules["backend-doctor/no-path-traversal"] = "error";

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config,
			});

			const byRule = Object.fromEntries(
				result.diagnostics.map((d) => [d.rule, d.severity]),
			);
			expect(byRule).toEqual({
				"backend-doctor/no-hardcoded-secrets": "warn",
				"backend-doctor/no-path-traversal": "error",
				"backend-doctor/no-command-injection": "warn",
				"backend-doctor/no-weak-crypto": "warn",
				"backend-doctor/no-unsafe-merge": "warn",
				"backend-doctor/no-ssrf": "warn",
			});
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runScan nest app model (AC-7, AC-10, spec 008)", () => {
	function makeProject(): string {
		return fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-nest-"));
	}

	it("exposes projects[0].nest for nest projects (AC-7)", async () => {
		const tmp = makeProject();
		try {
			fs.writeFileSync(
				path.join(tmp, "package.json"),
				JSON.stringify({
					name: "app",
					dependencies: { "@nestjs/common": "^10.0.0" },
				}),
			);
			fs.mkdirSync(path.join(tmp, "src"));
			fs.writeFileSync(
				path.join(tmp, "src", "app.module.ts"),
				[
					'import { Module } from "@nestjs/common";',
					'import { AppService } from "./app.service.js";',
					"",
					"@Module({",
					"\tproviders: [AppService],",
					"})",
					"export class AppModule {}",
				].join("\n"),
			);
			fs.writeFileSync(
				path.join(tmp, "src", "app.service.ts"),
				[
					'import { Injectable } from "@nestjs/common";',
					"",
					"@Injectable()",
					"export class AppService {}",
				].join("\n"),
			);

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["nest"]);
			expect(result.projects[0]?.nest).toEqual({
				modules: [
					expect.objectContaining({
						className: "AppModule",
						imports: [],
						providers: ["AppService"],
						controllers: [],
						exports: [],
					}),
				],
				controllers: [],
				providers: [expect.objectContaining({ className: "AppService" })],
				dtos: [],
				unresolved: [],
			});
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("omits the nest field for non-nest projects (AC-7)", async () => {
		const tmp = makeProject();
		try {
			fs.writeFileSync(
				path.join(tmp, "package.json"),
				JSON.stringify({ name: "app", dependencies: { express: "^4.19.2" } }),
			);
			fs.mkdirSync(path.join(tmp, "src"));
			fs.writeFileSync(
				path.join(tmp, "src", "main.ts"),
				"export const x = 1;\n",
			);

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			const project = result.projects[0];
			expect(project?.nest).toBeUndefined();
			expect(Object.keys(project ?? {})).not.toContain("nest");
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("exposes the all-empty model when a nest tree has no decorators (AC-10)", async () => {
		const tmp = makeProject();
		try {
			fs.writeFileSync(
				path.join(tmp, "package.json"),
				JSON.stringify({
					name: "app",
					dependencies: { "@nestjs/common": "^10.0.0" },
				}),
			);
			fs.mkdirSync(path.join(tmp, "src"));
			fs.writeFileSync(
				path.join(tmp, "src", "util.ts"),
				"export const x = 1;\n",
			);

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.nest).toEqual({
				modules: [],
				controllers: [],
				providers: [],
				dtos: [],
				unresolved: [],
			});
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runScan nest DI rules (AC-11, spec 009)", () => {
	function writeNestDiProject(): string {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-di-"));
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({
				name: "app",
				dependencies: { "@nestjs/common": "^10.0.0" },
			}),
		);
		fs.mkdirSync(path.join(tmp, "src"));
		fs.writeFileSync(
			path.join(tmp, "src", "app.module.ts"),
			[
				'import { Module } from "@nestjs/common";',
				'import { OrphanService } from "./orphan.service.js";',
				'import { TasksController } from "./tasks.controller.js";',
				'import { TasksService } from "./tasks.service.js";',
				'import { XService } from "./x.service.js";',
				'import { YService } from "./y.service.js";',
				"",
				"@Module({",
				"\tcontrollers: [TasksController],",
				"\tproviders: [TasksService, XService, YService],",
				"})",
				"export class AppModule {}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(tmp, "src", "tasks.service.ts"),
			[
				'import { Injectable } from "@nestjs/common";',
				"",
				"@Injectable()",
				"export class TasksService {}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(tmp, "src", "orphan.service.ts"),
			[
				'import { Injectable } from "@nestjs/common";',
				"",
				"@Injectable()",
				"export class OrphanService {}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(tmp, "src", "tasks.controller.ts"),
			[
				'import { Controller } from "@nestjs/common";',
				'import { OrphanService } from "./orphan.service.js";',
				'import { TasksService } from "./tasks.service.js";',
				"",
				'@Controller("tasks")',
				"export class TasksController {",
				"\tconstructor(",
				"\t\tprivate readonly tasks: TasksService,",
				"\t\tprivate readonly orphan: OrphanService,",
				"\t) {}",
				"}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(tmp, "src", "x.service.ts"),
			[
				'import { Injectable } from "@nestjs/common";',
				'import { YService } from "./y.service.js";',
				"",
				"@Injectable()",
				"export class XService {",
				"\tconstructor(private readonly y: YService) {}",
				"}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(tmp, "src", "y.service.ts"),
			[
				'import { Injectable } from "@nestjs/common";',
				'import { XService } from "./x.service.js";',
				"",
				"@Injectable()",
				"export class YService {",
				"\tconstructor(private readonly x: XService) {}",
				"}",
			].join("\n"),
		);
		return tmp;
	}

	it("reports DI violations through the full pipeline for nest projects (AC-11)", async () => {
		const tmp = writeNestDiProject();
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["nest"]);
			expect(result.projects[0]?.nest).toBeDefined();
			expect(
				result.diagnostics.map((d) => [
					rel(result, d.filePath),
					d.line,
					d.column,
					d.rule,
					d.severity,
				]),
			).toEqual([
				[
					"src/tasks.controller.ts",
					9,
					3,
					"backend-doctor/provider-not-registered",
					"warn",
				],
				[
					"src/x.service.ts",
					2,
					1,
					"backend-doctor/circular-dependency",
					"warn",
				],
				["src/x.service.ts", 4, 1, "backend-doctor/circular-di", "warn"],
				[
					"src/y.service.ts",
					2,
					1,
					"backend-doctor/circular-dependency",
					"warn",
				],
				[
					"src/y.service.ts",
					6,
					14,
					"backend-doctor/missing-forward-ref",
					"warn",
				],
			]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("reports no DI diagnostics for a non-nest project (AC-11)", async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-di-"));
		try {
			// Same wiring shapes, but no @nestjs markers: an express app with
			// local decorators. Nest is not detected, so the DI pack never runs.
			fs.writeFileSync(
				path.join(tmp, "package.json"),
				JSON.stringify({ name: "app", dependencies: { express: "^4.19.2" } }),
			);
			fs.mkdirSync(path.join(tmp, "src"));
			fs.writeFileSync(
				path.join(tmp, "src", "app.ts"),
				[
					'import express from "express";',
					"",
					"void express;",
					"function Injectable(): ClassDecorator {",
					"\treturn () => {};",
					"}",
					"",
					"@Injectable()",
					"export class OrphanService {}",
					"",
					"@Injectable()",
					"export class TasksService {}",
					"",
					"@Injectable()",
					"export class TasksController {",
					"\tconstructor(",
					"\t\tprivate readonly tasks: TasksService,",
					"\t\tprivate readonly orphan: OrphanService,",
					"\t) {}",
					"}",
				].join("\n"),
			);

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["express"]);
			expect(result.projects[0]?.nest).toBeUndefined();
			expect(result.diagnostics).toEqual([]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runScan layers & DTO pack (AC-10, AC-11, spec 010)", () => {
	function writeLayersProject(): string {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "backend-doctor-layers-"),
		);
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({
				name: "app",
				dependencies: { "@nestjs/common": "^10.0.0" },
			}),
		);
		fs.mkdirSync(path.join(tmp, "src"));
		fs.writeFileSync(
			path.join(tmp, "src", "main.ts"),
			[
				'import { NestFactory } from "@nestjs/core";',
				'import { AppModule } from "./app.module.js";',
				"",
				"async function bootstrap(): Promise<void> {",
				"\tconst app = await NestFactory.create(AppModule);",
				"\tawait app.listen(3000);",
				"}",
				"",
				"void bootstrap();",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(tmp, "src", "app.module.ts"),
			[
				'import { Module } from "@nestjs/common";',
				'import { ReportsController } from "./reports.controller.js";',
				'import { ReportsService } from "./reports.service.js";',
				"",
				"@Module({",
				"\tcontrollers: [ReportsController],",
				"\tproviders: [ReportsService],",
				"})",
				"export class AppModule {}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(tmp, "src", "reports.controller.ts"),
			[
				'import { Controller, Get } from "@nestjs/common";',
				"",
				'@Controller("reports")',
				"export class ReportsController {",
				"\tconstructor(",
				"\t\tprivate readonly reports: ReportsService,",
				"\t\tprivate readonly rows: ReportRowsRepository,",
				"\t) {}",
				"",
				"\t@Get()",
				"\tlist(): string[] {",
				"\t\tconst rows: string[] = [];",
				"\t\tfor (const row of rows) {",
				"\t\t\tif (row) {",
				"\t\t\t\trows.push(row);",
				"\t\t\t}",
				"\t\t}",
				"\t\treturn rows;",
				"\t}",
				"}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(tmp, "src", "reports.service.ts"),
			[
				'import { Injectable } from "@nestjs/common";',
				"",
				"@Injectable()",
				"export class ReportsService {}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(tmp, "src", "create-report.dto.ts"),
			["export class CreateReportDto {", "\ttitle: string;", "}"].join("\n"),
		);
		return tmp;
	}

	it("reports pack violations through the full pipeline for nest projects (AC-11)", async () => {
		const tmp = writeLayersProject();
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["nest"]);
			expect(
				result.diagnostics.map((d) => [
					rel(result, d.filePath),
					d.line,
					d.column,
					d.rule,
					d.severity,
				]),
			).toEqual([
				// The dto file is imported by nobody: unused export + file
				// (spec 013 graph findings on the staged tree).
				[
					"src/create-report.dto.ts",
					1,
					1,
					"backend-doctor/unused-export",
					"warn",
				],
				[
					"src/create-report.dto.ts",
					1,
					1,
					"backend-doctor/unused-file",
					"warn",
				],
				[
					"src/create-report.dto.ts",
					2,
					2,
					"backend-doctor/dto-field-without-validator",
					"warn",
				],
				[
					"src/main.ts",
					5,
					20,
					"backend-doctor/missing-global-validation-pipe",
					"warn",
				],
				[
					"src/reports.controller.ts",
					7,
					3,
					"backend-doctor/no-repository-in-controller",
					"warn",
				],
				[
					"src/reports.controller.ts",
					10,
					2,
					"backend-doctor/no-business-logic-in-controller",
					"warn",
				],
			]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("reports no pack diagnostics for a non-nest project (AC-11)", async () => {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "backend-doctor-layers-"),
		);
		try {
			fs.writeFileSync(
				path.join(tmp, "package.json"),
				JSON.stringify({ name: "app", dependencies: { express: "^4.19.2" } }),
			);
			fs.mkdirSync(path.join(tmp, "src"));
			fs.writeFileSync(
				path.join(tmp, "src", "app.ts"),
				[
					'import express from "express";',
					"",
					"const app = express();",
					"",
					"class CreateReportDto {",
					"\ttitle: string;",
					"}",
					"",
					"class ReportRowsRepository {}",
					"",
					"export class ReportsController {",
					"\tconstructor(private readonly rows: ReportRowsRepository) {}",
					"}",
				].join("\n"),
			);

			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["express"]);
			expect(result.diagnostics).toEqual([]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runScan errors & lifecycle rules (AC-6, spec 011)", () => {
	function writeLifecycleProject(nest: boolean): string {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "backend-doctor-lifecycle-"),
		);
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify(
				nest
					? { name: "nest-app", dependencies: { "@nestjs/common": "^10.0.0" } }
					: { name: "plain-app", dependencies: {} },
			),
		);
		const src = path.join(tmp, "src");
		fs.mkdirSync(src, { recursive: true });
		fs.writeFileSync(
			path.join(src, "app.ts"),
			[
				"declare function save(error: Error): void;",
				"",
				"export function report(",
				"\terror: Error,",
				"\tres: { json(body: unknown): void },",
				"): void {",
				"\ttry {",
				"\t\tsave(error);",
				"\t} catch {}",
				'\tres.json({ message: "failed", stack: error.stack });',
				"}",
			].join("\n"),
		);
		const service = nest
			? [
					'import { Injectable } from "@nestjs/common";',
					"",
					"declare function connect(): Promise<unknown>;",
					"",
					"@Injectable()",
					"export class TimerService {",
					"\tconstructor() {",
					"\t\tvoid connect();",
					"\t}",
					"",
					"\tonModuleInit(): void {}",
					"}",
				]
			: [
					"declare function connect(): Promise<unknown>;",
					"",
					"export class TimerService {",
					"\tconstructor() {",
					"\t\tvoid connect();",
					"\t}",
					"",
					"\tonModuleInit(): void {}",
					"}",
				];
		fs.writeFileSync(path.join(src, "timer.service.ts"), service.join("\n"));
		return tmp;
	}

	it("reports the pack through the full pipeline in a nest project", async () => {
		const tmp = writeLifecycleProject(true);
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(
				result.diagnostics.map((d) => [
					rel(result, d.filePath),
					d.line,
					d.column,
					d.rule,
					d.severity,
				]),
			).toEqual([
				["src/app.ts", 9, 4, "backend-doctor/no-empty-catch", "warn"],
				["src/app.ts", 10, 2, "backend-doctor/no-error-details-leak", "warn"],
				[
					"src/timer.service.ts",
					5,
					1,
					"backend-doctor/missing-on-module-destroy",
					"warn",
				],
				[
					"src/timer.service.ts",
					8,
					8,
					"backend-doctor/no-heavy-constructor-work",
					"warn",
				],
			]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("keeps the framework-free rules and silences the lifecycle pack without nest", async () => {
		const tmp = writeLifecycleProject(false);
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(
				result.diagnostics.map((d) => [
					rel(result, d.filePath),
					d.line,
					d.column,
					d.rule,
					d.severity,
				]),
			).toEqual([
				["src/app.ts", 9, 4, "backend-doctor/no-empty-catch", "warn"],
				["src/app.ts", 10, 2, "backend-doctor/no-error-details-leak", "warn"],
			]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runScan prisma pack (AC-6, spec 012)", () => {
	function writePrismaProject(withDependency: boolean): string {
		const tmp = fs.mkdtempSync(
			path.join(os.tmpdir(), "backend-doctor-prisma-"),
		);
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify(
				withDependency
					? { name: "prisma-app", dependencies: { "@prisma/client": "^5.0.0" } }
					: { name: "plain-app", dependencies: {} },
			),
		);
		const src = path.join(tmp, "src");
		fs.mkdirSync(src, { recursive: true });
		fs.writeFileSync(
			path.join(src, "users.service.ts"),
			[
				"declare function fetch(url: string): Promise<unknown>;",
				"declare const prisma: {",
				"\tuser: {",
				"\t\tfindMany(args?: unknown): Promise<{ id: number }[]>;",
				"\t\tcreate(args: unknown): Promise<unknown>;",
				"\t};",
				"\tpost: { findMany(args: unknown): Promise<unknown[]> };",
				"\t$queryRawUnsafe(query: string): Promise<unknown[]>;",
				"\t$transaction(fn: unknown): Promise<unknown>;",
				"};",
				"",
				"export async function load(): Promise<void> {",
				"\tconst users = await prisma.user.findMany();",
				"\tfor (const user of users) {",
				"\t\tconst posts = await prisma.post.findMany({",
				"\t\t\ttake: 10,",
				"\t\t\twhere: { userId: user.id },",
				"\t\t});",
				"\t\tvoid posts;",
				"\t}",
				'\tconst logs = await prisma.$queryRawUnsafe("SELECT * FROM Log WHERE user_id = " + users.length);',
				"\tvoid logs;",
				"\tawait prisma.$transaction(async () => {",
				'\t\tconst profile = await fetch("https://example.com");',
				"\t\tvoid profile;",
				"\t\tawait prisma.user.create({ data: { id: users.length } });",
				"\t});",
				"}",
				// The declared dependency is real in the violating tree: an
				// import keeps unused-dependency silent (positions unchanged).
				...(withDependency
					? ['import type { PrismaClient } from "@prisma/client";']
					: []),
			].join("\n"),
		);
		return tmp;
	}

	it("reports one violation per pack rule through the full pipeline", async () => {
		const tmp = writePrismaProject(true);
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual(["prisma"]);
			expect(
				result.diagnostics.map((d) => [
					rel(result, d.filePath),
					d.line,
					d.column,
					d.rule,
					d.severity,
				]),
			).toEqual([
				[
					"src/users.service.ts",
					13,
					22,
					"backend-doctor/find-many-without-pagination",
					"warn",
				],
				[
					"src/users.service.ts",
					15,
					23,
					"backend-doctor/no-prisma-n-plus-one",
					"warn",
				],
				[
					"src/users.service.ts",
					21,
					21,
					"backend-doctor/no-unsafe-raw-query",
					"warn",
				],
				[
					"src/users.service.ts",
					24,
					25,
					"backend-doctor/no-long-running-transaction",
					"warn",
				],
			]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("silences the whole pack without the @prisma/client dependency", async () => {
		const tmp = writePrismaProject(false);
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});

			expect(result.projects[0]?.frameworks).toEqual([]);
			expect(result.diagnostics).toEqual([]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runScan graph pack (spec 013, AC-6)", () => {
	function writeGraphProject(withViolations: boolean): string {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-graph-"));
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify(
				withViolations
					? {
							name: "app",
							scripts: { start: "node dist/main.js" },
							dependencies: { express: "^4.0.0", "left-pad": "^1.0.0" },
						}
					: { name: "app", dependencies: { express: "^4.0.0" } },
			),
		);
		const src = path.join(tmp, "src");
		fs.mkdirSync(src, { recursive: true });
		fs.writeFileSync(
			path.join(src, "main.ts"),
			['import { start } from "./app";', "", "void start();"].join("\n"),
		);
		if (withViolations) {
			fs.writeFileSync(
				path.join(src, "app.ts"),
				[
					'import express from "express";',
					'import { helper } from "./helper";',
					"",
					"export function start(): string {",
					"\treturn helper() + express;",
					"}",
				].join("\n"),
			);
			fs.writeFileSync(
				path.join(src, "helper.ts"),
				[
					'import { start } from "./app";',
					"",
					"export function helper(): string {",
					"\treturn start();",
					"}",
				].join("\n"),
			);
			fs.writeFileSync(
				path.join(src, "orphan.ts"),
				["export function orphan(): number {", "\treturn 1;", "}"].join("\n"),
			);
		} else {
			fs.writeFileSync(
				path.join(src, "app.ts"),
				[
					'import express from "express";',
					"",
					"export function start(): string {",
					"\treturn express;",
					"}",
				].join("\n"),
			);
		}
		return tmp;
	}

	it("reports cycles, orphans, unused exports and dependencies in report order", async () => {
		const tmp = writeGraphProject(true);
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});
			expect(
				result.diagnostics.map((d) => [
					rel(result, d.filePath),
					d.line,
					d.column,
					d.rule,
				]),
			).toEqual([
				["package.json", 1, 1, "backend-doctor/unused-dependency"],
				["src/app.ts", 2, 1, "backend-doctor/circular-dependency"],
				["src/helper.ts", 1, 1, "backend-doctor/circular-dependency"],
				["src/orphan.ts", 1, 1, "backend-doctor/unused-export"],
				["src/orphan.ts", 1, 1, "backend-doctor/unused-file"],
			]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("reports nothing on a clean connected tree", async () => {
		const tmp = writeGraphProject(false);
		try {
			const result = await runScan({
				directory: tmp,
				ignore: [],
				config: defaultConfig(),
			});
			expect(result.diagnostics).toEqual([]);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
