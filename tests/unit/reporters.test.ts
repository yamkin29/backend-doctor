import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/core/report.js";
import type { ScanResult } from "../../src/core/scan.js";
import type { Diagnostic } from "../../src/core/types.js";
import { renderJsonl } from "../../src/reporters/jsonl.js";
import { renderPretty } from "../../src/reporters/pretty.js";

const emptyResult: ScanResult = {
	input: { directory: "/tmp/proj", ignore: [] },
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
});
