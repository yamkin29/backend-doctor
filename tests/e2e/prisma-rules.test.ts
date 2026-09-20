import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

function serviceSource(withDependency: boolean): string {
	// The trailing type-only import keeps unused-dependency silent in the
	// dependency variant without shifting the pinned violation positions.
	return [
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
		...(withDependency
			? ['import type { PrismaClient } from "@prisma/client";']
			: []),
	].join("\n");
}

const PACK_RULES = [
	"backend-doctor/find-many-without-pagination",
	"backend-doctor/no-long-running-transaction",
	"backend-doctor/no-prisma-n-plus-one",
	"backend-doctor/no-unsafe-raw-query",
];

function writePrismaApp(withDependency: boolean): string {
	const app = makeTmpDir();
	fs.writeFileSync(
		path.join(app, "package.json"),
		JSON.stringify(
			withDependency
				? { name: "prisma-app", dependencies: { "@prisma/client": "^5.0.0" } }
				: { name: "plain-app", dependencies: {} },
		),
	);
	fs.mkdirSync(path.join(app, "src"));
	fs.writeFileSync(
		path.join(app, "src", "users.service.ts"),
		serviceSource(withDependency),
	);
	return app;
}

interface DiagnosticStub {
	rule: string;
	severity: string;
	filePath: string;
	line: number;
	column: number;
}

let app: string;

beforeEach(() => {
	app = writePrismaApp(true);
});

afterEach(() => {
	fs.rmSync(app, { recursive: true, force: true });
});

describe("e2e: prisma rules through the bin (spec 012)", () => {
	it("reports one violation per pack rule at warn and exits 0 (AC-6)", () => {
		const result = runCli(["scan", app, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: DiagnosticStub[];
		};
		expect(
			doc.diagnostics.map((d) => [
				path.relative(app, d.filePath),
				d.line,
				d.column,
				d.rule,
				d.severity,
			]),
		).toEqual([
			[
				path.join("src", "users.service.ts"),
				13,
				22,
				"backend-doctor/find-many-without-pagination",
				"warn",
			],
			[
				path.join("src", "users.service.ts"),
				15,
				23,
				"backend-doctor/no-prisma-n-plus-one",
				"warn",
			],
			[
				path.join("src", "users.service.ts"),
				21,
				21,
				"backend-doctor/no-unsafe-raw-query",
				"warn",
			],
			[
				path.join("src", "users.service.ts"),
				24,
				25,
				"backend-doctor/no-long-running-transaction",
				"warn",
			],
		]);
	});

	it("two consecutive scans are byte-identical (AC-7)", () => {
		const first = runCli(["scan", app, "--format", "json"]);
		const second = runCli(["scan", app, "--format", "json"]);
		expectSuccess(first, 0);
		expect(second.stdout).toBe(first.stdout);
	});

	it("escalating no-unsafe-raw-query to error flips exit code to 1 (AC-8)", () => {
		const configPath = path.join(app, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: { "backend-doctor/no-unsafe-raw-query": "error" },
			}),
		);
		const escalated = runCli([
			"scan",
			app,
			"--format",
			"json",
			"--config",
			configPath,
		]);
		expectSuccess(escalated, 1);
		const escalatedDoc = JSON.parse(escalated.stdout) as {
			diagnostics: DiagnosticStub[];
		};
		const raw = escalatedDoc.diagnostics.find(
			(d) => d.rule === "backend-doctor/no-unsafe-raw-query",
		);
		expect(raw?.severity).toBe("error");
	});

	it("turning the whole pack off empties the report (AC-8)", () => {
		const configPath = path.join(app, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: Object.fromEntries(PACK_RULES.map((rule) => [rule, "off"])),
			}),
		);
		const silenced = runCli([
			"scan",
			app,
			"--format",
			"json",
			"--config",
			configPath,
		]);
		expectSuccess(silenced, 0);
		const silencedDoc = JSON.parse(silenced.stdout) as {
			diagnostics: unknown[];
		};
		expect(silencedDoc.diagnostics).toEqual([]);
	});

	it("jsonl stays diagnostics-only (AC-8)", () => {
		const result = runCli(["scan", app, "--format", "jsonl"]);
		expectSuccess(result, 0);
		const lines = result.stdout.trimEnd().split("\n");
		expect(lines).toHaveLength(4);
		const packRules = new Set(PACK_RULES);
		for (const line of lines) {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			expect(packRules.has(parsed.rule as string)).toBe(true);
		}
	});

	it("a dependency-free tree produces none of the pack findings (AC-6)", () => {
		const plain = writePrismaApp(false);
		try {
			const result = runCli(["scan", plain, "--format", "json"]);
			expectSuccess(result, 0);
			const doc = JSON.parse(result.stdout) as {
				diagnostics: unknown[];
			};
			expect(doc.diagnostics).toEqual([]);
		} finally {
			fs.rmSync(plain, { recursive: true, force: true });
		}
	});
});
