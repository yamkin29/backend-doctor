import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/types.js";
import { exitCodeFor } from "../../src/core/exit-code.js";
import { buildReport } from "../../src/core/report.js";
import type { ScanResult } from "../../src/core/scan.js";
import type { Diagnostic } from "../../src/core/types.js";

function resultWith(diagnostics: Diagnostic[]): ScanResult {
	return {
		input: { directory: "/tmp/proj", ignore: [], config: defaultConfig() },
		diagnostics,
		projects: [],
	};
}

const warnDiagnostic: Diagnostic = {
	id: "d1",
	filePath: "/tmp/proj/src/a.ts",
	line: 1,
	column: 1,
	rule: "backend-doctor/rule-a",
	category: "Bugs",
	severity: "warn",
	message: "Warn message",
	tags: [],
};

const errorDiagnostic: Diagnostic = { ...warnDiagnostic, severity: "error" };

describe("buildReport", () => {
	it("produces the exact schemaVersion-1 document", () => {
		const doc = buildReport(resultWith([]));
		expect(doc).toEqual({
			schemaVersion: 1,
			mode: "full",
			directory: "/tmp/proj",
			diagnostics: [],
			projects: [],
		});
	});

	it("passes diagnostics through unchanged", () => {
		const doc = buildReport(resultWith([warnDiagnostic]));
		expect(doc.diagnostics).toEqual([warnDiagnostic]);
	});
});

describe("exitCodeFor", () => {
	it("returns 0 when there are no diagnostics", () => {
		expect(exitCodeFor(buildReport(resultWith([])))).toBe(0);
	});

	it("returns 0 when only warnings are present", () => {
		expect(exitCodeFor(buildReport(resultWith([warnDiagnostic])))).toBe(0);
	});

	it("returns 1 when at least one error is present", () => {
		expect(
			exitCodeFor(buildReport(resultWith([warnDiagnostic, errorDiagnostic]))),
		).toBe(1);
	});
});
