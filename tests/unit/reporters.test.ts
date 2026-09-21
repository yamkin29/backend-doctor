import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/types.js";
import { buildReport } from "../../src/core/report.js";
import type { ScanResult } from "../../src/core/scan.js";
import type { Diagnostic } from "../../src/core/types.js";
import { renderJsonl } from "../../src/reporters/jsonl.js";
import { renderPretty } from "../../src/reporters/pretty.js";

const emptyResult: ScanResult = {
	input: { directory: "/tmp/proj", ignore: [], config: defaultConfig() },
	diagnostics: [],
	projects: [],
};

describe("renderPretty", () => {
	it("renders an empty scan with a zero-issue summary", () => {
		const doc = buildReport(emptyResult);
		expect(renderPretty(doc)).toBe(
			[
				"backend-doctor scan — full mode",
				"Directory: /tmp/proj",
				"",
				"Summary: 0 errors, 0 warnings (0 issues)",
				"",
			].join("\n"),
		);
	});

	it("lists diagnostics with relative paths and pluralizes correctly", () => {
		const doc = buildReport({
			...emptyResult,
			diagnostics: [
				{
					id: "digest-1",
					filePath: "/tmp/proj/src/a.ts",
					line: 3,
					column: 5,
					rule: "backend-doctor/no-demo-rule",
					category: "Bugs",
					severity: "error",
					message: "Demo problem",
					tags: [],
				},
			],
		});
		const out = renderPretty(doc);
		expect(out).toContain("src/a.ts:3:5");
		expect(out).toContain("backend-doctor/no-demo-rule");
		expect(out).toContain("Demo problem");
		expect(out).toContain("Summary: 1 error, 0 warnings (1 issue)");
	});
	it("renders a Frameworks line under Directory when frameworks are detected (AC-14)", () => {
		const doc = buildReport({
			...emptyResult,
			projects: [
				{
					packageRoot: "/tmp/proj",
					frameworks: ["nest", "prisma"],
					analyzedFiles: ["src/main.ts"],
					analyzedFileCount: 1,
					complete: true,
					skippedChecks: [],
				},
			],
		});

		const out = renderPretty(doc);
		const lines = out.split("\n");
		expect(lines[1]).toBe("Directory: /tmp/proj");
		expect(lines[2]).toBe("Frameworks: nest, prisma");
	});

	it("renders no Frameworks line when the list is empty", () => {
		expect(renderPretty(buildReport(emptyResult))).not.toContain("Frameworks:");
	});

	it("renders a Runtime trace header line and ../-relative diagnostics for a merged doc (spec 021 AC-13)", () => {
		const sessionDir = "/repo/.backend-doctor/probe/s1";
		const doc = buildReport(
			{
				...emptyResult,
				diagnostics: [
					{
						id: "rt-1",
						filePath: "/elsewhere/x.ts",
						line: 2,
						column: 3,
						rule: "backend-doctor/runtime-blocking-call",
						category: "Runtime",
						severity: "warn",
						message: "readFileSync blocked the event loop",
						tags: ["runtime"],
					},
				],
			},
			{ sessionDir, traceSchemaVersion: 1 },
		);
		const out = renderPretty(doc);
		expect(out).toContain(`Runtime trace: ${sessionDir}`);
		expect(out).toContain("../elsewhere/x.ts:2:3");
		expect(out).toContain("backend-doctor/runtime-blocking-call");
		expect(out).toContain("Summary: 0 errors, 1 warning (1 issue)");
		// Without a trace the header line is absent (additive-line precedent).
		expect(renderPretty(buildReport(emptyResult))).not.toContain(
			"Runtime trace:",
		);
	});
});

describe("renderJsonl", () => {
	it("renders nothing for an empty report", () => {
		expect(renderJsonl(buildReport(emptyResult))).toBe("");
	});

	it("renders one JSON diagnostic per line with a trailing newline", () => {
		const diagnostic: Diagnostic = {
			id: "digest-1",
			filePath: "/tmp/proj/src/a.ts",
			line: 3,
			column: 5,
			rule: "backend-doctor/no-demo-rule",
			category: "Bugs",
			severity: "warn",
			message: "Demo problem",
			tags: ["demo"],
		};
		const second: Diagnostic = { ...diagnostic, id: "digest-2", line: 9 };
		const doc = buildReport({
			...emptyResult,
			diagnostics: [diagnostic, second],
		});

		const out = renderJsonl(doc);
		const lines = out.split("\n");
		expect(lines).toHaveLength(3); // two diagnostics + trailing newline
		expect(lines[2]).toBe("");
		expect(JSON.parse(lines[0] as string)).toEqual(diagnostic);
		expect(JSON.parse(lines[1] as string)).toEqual(second);
	});

	it("emits runtime diagnostics as lines in construction order (spec 021 AC-13)", () => {
		const runtimeDiagnostic: Diagnostic = {
			id: "rt-1",
			filePath: "/tmp/proj/.backend-doctor/probe/s1/findings.json",
			line: 1,
			column: 1,
			rule: "backend-doctor/runtime-possible-n1",
			category: "Runtime",
			severity: "warn",
			message:
				"endpoint GET /bulk saw up to 3 db queries in one request (possible N+1)",
			tags: ["runtime"],
		};
		const doc = buildReport({
			...emptyResult,
			diagnostics: [runtimeDiagnostic],
		});
		const out = renderJsonl(doc);
		const parsed = JSON.parse(out.trimEnd()) as Record<string, unknown>;
		expect(parsed).toEqual(runtimeDiagnostic);
		// The spec 017 jsonl pin: keys serialize in the Diagnostic declaration
		// order, so agent-facing bytes stay stable.
		expect(Object.keys(parsed)).toEqual([
			"id",
			"filePath",
			"line",
			"column",
			"rule",
			"category",
			"severity",
			"message",
			"tags",
		]);
	});
});
