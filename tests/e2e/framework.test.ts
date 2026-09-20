import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

let app: string;

beforeEach(() => {
	app = makeTmpDir();
	fs.writeFileSync(
		path.join(app, "package.json"),
		JSON.stringify({
			name: "fw-app",
			dependencies: { express: "^4.19.2", lodash: "^4.17.0" },
		}),
	);
	fs.mkdirSync(path.join(app, "src"));
	fs.writeFileSync(
		path.join(app, "src", "main.ts"),
		'import express from "express";\nconst value = eval("1");\nexport { value };\n',
	);
});

afterEach(() => {
	fs.rmSync(app, { recursive: true, force: true });
});

describe("e2e: framework contract through the bin (spec 004)", () => {
	it("json report carries projects[0].frameworks with schemaVersion unchanged (AC-14)", () => {
		const result = runCli(["scan", app, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			schemaVersion: number;
			diagnostics: unknown[];
			projects: Array<Record<string, unknown>>;
		};
		expect(doc.schemaVersion).toBe(1);
		// no-eval + unused-dependency: lodash is declared, never imported
		// (spec 013 graph finding on the staged tree).
		expect(doc.diagnostics).toHaveLength(2);
		expect(doc.projects[0]?.frameworks).toEqual(["express"]);
	});

	it("pretty report names the detected framework (AC-14)", () => {
		const result = runCli(["scan", app]);
		expectSuccess(result, 0);
		expect(result.stdout).toContain("Frameworks: express");
	});

	it("jsonl keeps the diagnostics-only shape (AC-14)", () => {
		const result = runCli(["scan", app, "--format", "jsonl"]);
		expectSuccess(result, 0);

		const lines = result.stdout.trimEnd().split("\n");
		expect(lines).toHaveLength(2);
		const parsed = lines.map(
			(line) => JSON.parse(line) as Record<string, unknown>,
		);
		expect(parsed.map((d) => d.rule)).toEqual([
			"backend-doctor/unused-dependency",
			"backend-doctor/no-eval",
		]);
		expect(Object.keys(parsed[0] as Record<string, unknown>)).not.toContain(
			"frameworks",
		);
	});

	it("two consecutive scans are byte-identical (AC-13)", () => {
		const first = runCli(["scan", app, "--format", "json"]);
		const second = runCli(["scan", app, "--format", "json"]);
		expectSuccess(first, 0);
		expect(second.stdout).toBe(first.stdout);
	});
});
