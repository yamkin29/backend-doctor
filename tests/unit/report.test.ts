import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/types.js";
import { exitCodeFor } from "../../src/core/exit-code.js";
import { buildReport } from "../../src/core/report.js";
import type { ScanResult } from "../../src/core/scan.js";
import type { Diagnostic } from "../../src/core/types.js";
import type { ResolvedScope, ScopeMode } from "../../src/scope/types.js";

function resultWith(diagnostics: Diagnostic[]): ScanResult {
	return {
		input: { directory: "/tmp/proj", ignore: [], config: defaultConfig() },
		diagnostics,
		projects: [],
	};
}

function scopeWithMode(mode: ScopeMode, base?: string): ResolvedScope {
	return {
		mode,
		files: new Set<string>(),
		lineRanges: new Map(),
		...(base !== undefined ? { base } : {}),
	};
}

function scopedResultWith(scope: ResolvedScope): ScanResult {
	return {
		input: {
			directory: "/tmp/proj",
			ignore: [],
			config: defaultConfig(),
			scope,
		},
		diagnostics: [],
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

describe("buildReport — scope (spec 015)", () => {
	it("mirrors the scope mode into the report mode", () => {
		const doc = buildReport(scopedResultWith(scopeWithMode("files")));
		expect(doc.mode).toBe("files");
	});

	it("carries scope.base only for changed and lines scopes", () => {
		const changed = buildReport(
			scopedResultWith(scopeWithMode("changed", "main")),
		);
		expect(changed.mode).toBe("changed");
		expect(changed.scope).toEqual({ base: "main" });

		const lines = buildReport(scopedResultWith(scopeWithMode("lines", "HEAD")));
		expect(lines.mode).toBe("lines");
		expect(lines.scope).toEqual({ base: "HEAD" });

		const files = buildReport(scopedResultWith(scopeWithMode("files")));
		expect(files.scope).toBeUndefined();
		expect(Object.keys(files)).not.toContain("scope");
	});
});

describe("buildReport — runtime provenance (spec 021)", () => {
	const provenance = {
		sessionDir: "/repo/.backend-doctor/probe/s1",
		traceSchemaVersion: 1 as const,
	};

	it("appends the runtime block as the document's last key", () => {
		const doc = buildReport(resultWith([]), provenance);
		expect(doc.runtime).toEqual(provenance);
		expect(Object.keys(doc)).toEqual([
			"schemaVersion",
			"mode",
			"directory",
			"diagnostics",
			"projects",
			"runtime",
		]);
	});

	it("keeps the runtime block after an optional scope block", () => {
		const doc = buildReport(
			scopedResultWith(scopeWithMode("changed", "main")),
			provenance,
		);
		expect(Object.keys(doc)).toEqual([
			"schemaVersion",
			"mode",
			"scope",
			"directory",
			"diagnostics",
			"projects",
			"runtime",
		]);
	});

	it("omits the key entirely without a trace", () => {
		const doc = buildReport(resultWith([]));
		expect(Object.keys(doc)).not.toContain("runtime");
	});
});

describe("exitCodeFor — with runtime diagnostics (spec 021 AC-11)", () => {
	const runtimeWarn: Diagnostic = {
		id: "rt1",
		filePath: "/repo/src/a.ts",
		line: 42,
		column: 7,
		rule: "backend-doctor/runtime-blocking-call",
		category: "Runtime",
		severity: "warn",
		message: "readFileSync blocked the event loop",
		tags: ["runtime"],
	};

	it("returns 0 for a warn-only report containing runtime diagnostics", () => {
		expect(exitCodeFor(buildReport(resultWith([runtimeWarn])))).toBe(0);
	});

	it("still returns 1 when a static error accompanies runtime diagnostics", () => {
		expect(
			exitCodeFor(buildReport(resultWith([runtimeWarn, errorDiagnostic]))),
		).toBe(1);
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
