/**
 * Runtime findings → diagnostics (spec 021). Pure synthesis from a parsed
 * findings.json: the same trace always yields the same diagnostics with the
 * same ids, so merged reports are byte-identical for identical inputs
 * (constitution §1). The values inside describe a real execution and vary
 * between runs; what is pinned is the derivation.
 */
import path from "node:path";
import type { Diagnostic } from "../core/types.js";
import { createDiagnosticId } from "../engine/diagnostic-id.js";
import type { FindingsDocument } from "../probe/types.js";

/** Report-level ids: deliberately not registered rules (spec 021, OQ-2/OQ-3). */
export const RUNTIME_BLOCKING_RULE = "backend-doctor/runtime-blocking-call";
export const RUNTIME_N1_RULE = "backend-doctor/runtime-possible-n1";

export interface RuntimeMergeInput {
	/** The parsed findings.json of the merged probe session. */
	findings: FindingsDocument;
	/** Absolute path of that findings.json — N+1 diagnostics position here. */
	findingsPath: string;
	/** The probe process cwd recorded by session.json; base for relative culprit paths. */
	sessionCwd: string;
	/** Absolute scan target — the base for diagnostic-id relative paths. */
	scanRoot: string;
}

function relativePosix(filePath: string, scanRoot: string): string {
	return path.relative(scanRoot, filePath).split(path.sep).join("/");
}

/**
 * Blocking call sites first (findings order), then possible-N+1 endpoints
 * (endpoint order). Missing findings sections degrade to zero diagnostics
 * (design decision 2): the trace contract lets consumers ignore absent
 * fields, and absence of findings is not load-bearing — unlike a missing
 * session cwd, which the loader rejects.
 */
export function buildRuntimeDiagnostics(
	input: RuntimeMergeInput,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	for (const call of input.findings.blocking?.calls ?? []) {
		const filePath = path.isAbsolute(call.file)
			? call.file
			: path.resolve(input.sessionCwd, call.file);
		const line = call.line ?? 1;
		const column = call.column ?? 1;
		const message =
			`${call.api} blocked the event loop for up to ${call.maxMs}ms ` +
			`(${call.count} call(s), total ${call.totalMs}ms)`;
		diagnostics.push({
			id: createDiagnosticId({
				file: relativePosix(filePath, input.scanRoot),
				line,
				column,
				rule: RUNTIME_BLOCKING_RULE,
				message,
			}),
			filePath,
			line,
			column,
			rule: RUNTIME_BLOCKING_RULE,
			category: "Runtime",
			severity: "warn",
			message,
			tags: ["runtime"],
		});
	}

	const threshold = input.findings.collectors?.n1Threshold;
	for (const endpoint of input.findings.http?.endpoints ?? []) {
		const max = endpoint.dbQueries?.max;
		if (max === undefined || threshold === undefined || max < threshold) {
			continue;
		}
		const message =
			`endpoint ${endpoint.method} ${endpoint.route} saw up to ${max} ` +
			"db queries in one request (possible N+1)";
		diagnostics.push({
			id: createDiagnosticId({
				file: relativePosix(input.findingsPath, input.scanRoot),
				line: 1,
				column: 1,
				rule: RUNTIME_N1_RULE,
				message,
			}),
			filePath: input.findingsPath,
			line: 1,
			column: 1,
			rule: RUNTIME_N1_RULE,
			category: "Runtime",
			severity: "warn",
			message,
			tags: ["runtime"],
		});
	}

	return diagnostics;
}
