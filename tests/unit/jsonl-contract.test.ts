import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/types.js";
import { buildReport } from "../../src/core/report.js";
import type { ScanResult } from "../../src/core/scan.js";
import type { Diagnostic, ReportDocument } from "../../src/core/types.js";
import { renderJsonl } from "../../src/reporters/jsonl.js";

/**
 * Spec 017 AC-7: `--format jsonl` is a pinned stable surface. Exactly one
 * JSON object per diagnostic in report order, keys exactly the Diagnostic
 * fields in declaration order, nothing else on stdout, empty output for an
 * empty report, byte-identical double renders.
 */
const DIAGNOSTIC_FIELD_ORDER = [
	"id",
	"filePath",
	"line",
	"column",
	"rule",
	"category",
	"severity",
	"message",
	"tags",
] as const;

function makeDiagnostic(overrides: Partial<Diagnostic>): Diagnostic {
	return {
		id: "src/a.ts::3:5::backend-doctor/no-eval::digest",
		filePath: "/tmp/proj/src/a.ts",
		line: 3,
		column: 5,
		rule: "backend-doctor/no-eval",
		category: "Security",
		severity: "warn",
		message: "Demo problem",
		tags: [],
		...overrides,
	};
}

function makeDoc(diagnostics: Diagnostic[]): ReportDocument {
	const result: ScanResult = {
		input: { directory: "/tmp/proj", ignore: [], config: defaultConfig() },
		diagnostics,
		projects: [],
	};
	return buildReport(result);
}

const twoFindings = makeDoc([
	makeDiagnostic({}),
	makeDiagnostic({
		id: "src/b.ts::10:1::backend-doctor/no-prisma-n-plus-one::digest",
		filePath: "/tmp/proj/src/b.ts",
		line: 10,
		column: 1,
		rule: "backend-doctor/no-prisma-n-plus-one",
		category: "Performance",
		severity: "error",
		message: "Query inside a loop",
		tags: ["prisma"],
	}),
]);

describe("jsonl stability contract (spec 017 AC-7)", () => {
	it("emits exactly one line per diagnostic in report order", () => {
		const out = renderJsonl(twoFindings);
		const lines = out.split("\n");
		expect(lines).toHaveLength(3); // two findings + trailing newline
		expect(lines[2]).toBe("");
		const parsed = lines.slice(0, 2).map((line) => JSON.parse(line));
		expect(parsed.map((d) => d.rule)).toEqual([
			"backend-doctor/no-eval",
			"backend-doctor/no-prisma-n-plus-one",
		]);
		expect(parsed.map((d) => d.id)).toEqual([
			"src/a.ts::3:5::backend-doctor/no-eval::digest",
			"src/b.ts::10:1::backend-doctor/no-prisma-n-plus-one::digest",
		]);
	});

	it("carries exactly the Diagnostic fields in declaration order", () => {
		for (const line of renderJsonl(twoFindings).split("\n")) {
			if (line === "") continue;
			expect(Object.keys(JSON.parse(line))).toEqual([
				...DIAGNOSTIC_FIELD_ORDER,
			]);
		}
	});

	it("renders an empty report as zero bytes", () => {
		expect(renderJsonl(makeDoc([]))).toBe("");
	});

	it("is byte-identical across renders of the same report", () => {
		expect(renderJsonl(twoFindings)).toBe(renderJsonl(twoFindings));
	});
});
