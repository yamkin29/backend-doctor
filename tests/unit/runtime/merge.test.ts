import { describe, expect, it } from "vitest";
import { buildReport } from "../../../src/core/report.js";
import type { Diagnostic } from "../../../src/core/types.js";
import { createDiagnosticId } from "../../../src/engine/diagnostic-id.js";
import type {
	FindingsCall,
	FindingsDocument,
	FindingsEndpoint,
} from "../../../src/probe/types.js";
import { renderJson } from "../../../src/reporters/json.js";
import { renderJsonl } from "../../../src/reporters/jsonl.js";
import { renderPretty } from "../../../src/reporters/pretty.js";
import {
	buildRuntimeDiagnostics,
	RUNTIME_BLOCKING_RULE,
	RUNTIME_N1_RULE,
} from "../../../src/runtime/merge.js";

const SCAN_ROOT = "/repo";
const SESSION_CWD = "/repo";
const FINDINGS_PATH = "/repo/.backend-doctor/probe/s1/findings.json";

function call(overrides: Partial<FindingsCall> = {}): FindingsCall {
	return {
		api: "readFileSync",
		count: 3,
		totalMs: 456.8,
		maxMs: 152.1,
		file: "src/users.service.ts",
		line: 42,
		column: 7,
		function: "listUsers",
		asyncRootType: "",
		...overrides,
	};
}

function endpoint(overrides: Partial<FindingsEndpoint> = {}): FindingsEndpoint {
	return {
		method: "GET",
		route: "/users/:id",
		count: 5,
		p50Ms: 3.2,
		p99Ms: 41,
		maxMs: 41,
		statuses: { 200: 5 },
		dbQueries: { total: 57, max: 20, avg: 11.4 },
		...overrides,
	};
}

function findingsDoc(
	overrides: Partial<FindingsDocument> = {},
): FindingsDocument {
	return {
		traceSchemaVersion: 1,
		sessionId: "s1",
		collectors: { blockThresholdMs: 20, lagIntervalMs: 1000, n1Threshold: 20 },
		loopLag: { windows: 0, count: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 },
		blocking: { count: 0, totalMs: 0, calls: [] },
		http: { requests: 0, endpoints: [] },
		db: { queries: 0, totalMs: 0, unattributed: 0, models: [] },
		memory: {
			samples: 0,
			peakRssMb: 0,
			peakHeapUsedMb: 0,
			gc: { count: 0, totalPauseMs: 0, maxPauseMs: 0 },
		},
		events: { lines: 0, malformedLines: 0, attachProcesses: 0 },
		warnings: [],
		...overrides,
	};
}

function merge(findings: FindingsDocument): Diagnostic[] {
	return buildRuntimeDiagnostics({
		findings,
		findingsPath: FINDINGS_PATH,
		sessionCwd: SESSION_CWD,
		scanRoot: SCAN_ROOT,
	});
}

describe("buildRuntimeDiagnostics — blocking call sites (AC-4)", () => {
	it("resolves a relative culprit against the session cwd", () => {
		const [diagnostic] = merge(
			findingsDoc({
				blocking: { count: 1, totalMs: 456.8, calls: [call()] },
			}),
		);
		expect(diagnostic).toEqual({
			id: createDiagnosticId({
				file: "src/users.service.ts",
				line: 42,
				column: 7,
				rule: RUNTIME_BLOCKING_RULE,
				message:
					"readFileSync blocked the event loop for up to 152.1ms (3 call(s), total 456.8ms)",
			}),
			filePath: "/repo/src/users.service.ts",
			line: 42,
			column: 7,
			rule: RUNTIME_BLOCKING_RULE,
			category: "Runtime",
			severity: "warn",
			message:
				"readFileSync blocked the event loop for up to 152.1ms (3 call(s), total 456.8ms)",
			tags: ["runtime"],
		});
	});

	it("keeps an absolute culprit and pins its ../ relative id outside the scan root", () => {
		const [diagnostic] = merge(
			findingsDoc({
				blocking: {
					count: 1,
					totalMs: 5,
					calls: [call({ file: "/elsewhere/x.ts", line: 2, column: 3 })],
				},
			}),
		);
		expect(diagnostic?.filePath).toBe("/elsewhere/x.ts");
		expect(diagnostic?.id.startsWith("../elsewhere/x.ts::2:3::")).toBe(true);
	});

	it("falls back to 1 for null line and column", () => {
		const [diagnostic] = merge(
			findingsDoc({
				blocking: {
					count: 1,
					totalMs: 5,
					calls: [call({ line: null, column: null })],
				},
			}),
		);
		expect(diagnostic?.line).toBe(1);
		expect(diagnostic?.column).toBe(1);
		expect(diagnostic?.id).toContain("::1:1::");
	});
});

describe("buildRuntimeDiagnostics — possible N+1 (AC-5)", () => {
	it("emits one diagnostic when the max equals the threshold", () => {
		const [diagnostic] = merge(
			findingsDoc({ http: { requests: 5, endpoints: [endpoint()] } }),
		);
		const message =
			"endpoint GET /users/:id saw up to 20 db queries in one request (possible N+1)";
		expect(diagnostic).toEqual({
			id: createDiagnosticId({
				file: ".backend-doctor/probe/s1/findings.json",
				line: 1,
				column: 1,
				rule: RUNTIME_N1_RULE,
				message,
			}),
			filePath: FINDINGS_PATH,
			line: 1,
			column: 1,
			rule: RUNTIME_N1_RULE,
			category: "Runtime",
			severity: "warn",
			message,
			tags: ["runtime"],
		});
	});

	it("emits nothing below the threshold", () => {
		const diagnostics = merge(
			findingsDoc({
				http: {
					requests: 5,
					endpoints: [endpoint({ dbQueries: { total: 19, max: 19, avg: 19 } })],
				},
			}),
		);
		expect(diagnostics).toEqual([]);
	});
});

describe("buildRuntimeDiagnostics — coverage and coexistence", () => {
	it("emits exactly one diagnostic per findings row, in findings order (AC-6)", () => {
		const diagnostics = merge(
			findingsDoc({
				blocking: {
					count: 2,
					totalMs: 100,
					calls: [call({ api: "a" }), call({ api: "b" })],
				},
				http: { requests: 1, endpoints: [endpoint()] },
			}),
		);
		expect(diagnostics.map((d) => d.rule)).toEqual([
			RUNTIME_BLOCKING_RULE,
			RUNTIME_BLOCKING_RULE,
			RUNTIME_N1_RULE,
		]);
		expect(diagnostics.map((d) => d.message)).toEqual([
			"a blocked the event loop for up to 152.1ms (3 call(s), total 456.8ms)",
			"b blocked the event loop for up to 152.1ms (3 call(s), total 456.8ms)",
			"endpoint GET /users/:id saw up to 20 db queries in one request (possible N+1)",
		]);
	});

	it("emits zero diagnostics for an empty findings document (AC-7)", () => {
		expect(merge(findingsDoc())).toEqual([]);
	});

	it("tolerates missing findings sections as zero (AC-7, design decision 2)", () => {
		const { blocking, http, collectors, ...rest } = findingsDoc();
		expect(blocking).toBeDefined();
		const diagnostics = buildRuntimeDiagnostics({
			findings: rest as FindingsDocument,
			findingsPath: FINDINGS_PATH,
			sessionCwd: SESSION_CWD,
			scanRoot: SCAN_ROOT,
		});
		expect(diagnostics).toEqual([]);
	});

	it("keeps a static diagnostic at the same site alongside the runtime row (AC-9)", () => {
		const staticDiagnostic: Diagnostic = {
			id: "static-id",
			filePath: "/repo/src/users.service.ts",
			line: 42,
			column: 7,
			rule: "backend-doctor/no-sync-fs-in-request-path",
			category: "Performance",
			severity: "warn",
			message: "static finding",
			tags: [],
		};
		const merged = [
			staticDiagnostic,
			...merge(
				findingsDoc({
					blocking: { count: 1, totalMs: 456.8, calls: [call()] },
				}),
			),
		];
		expect(merged).toHaveLength(2);
		expect(merged.map((d) => d.rule)).toEqual([
			"backend-doctor/no-sync-fs-in-request-path",
			RUNTIME_BLOCKING_RULE,
		]);
	});
});

describe("buildRuntimeDiagnostics — determinism (AC-14)", () => {
	it("renders byte-identically through every reporter on re-merge", () => {
		const findings = findingsDoc({
			blocking: { count: 1, totalMs: 456.8, calls: [call()] },
			http: { requests: 5, endpoints: [endpoint()] },
		});
		const first = merge(findings);
		const second = merge(findings);
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));

		const doc = () =>
			buildReport({
				input: {
					directory: SCAN_ROOT,
					ignore: [],
					config: {
						rules: {},
						categories: {},
						ignore: { files: [], rules: [] },
						source: { kind: "default", path: null },
					},
				},
				diagnostics: first,
				projects: [],
			});
		expect(renderJson(doc())).toBe(renderJson(doc()));
		expect(renderJsonl(doc())).toBe(renderJsonl(doc()));
		expect(renderPretty(doc())).toBe(renderPretty(doc()));
	});
});
