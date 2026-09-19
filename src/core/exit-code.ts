import type { ReportDocument } from "./types.js";

/**
 * Exit-code policy (constitution §5): 1 iff at least one error-severity
 * diagnostic, else 0. Usage errors short-circuit to 2 in cli/run.ts.
 */
export function exitCodeFor(doc: ReportDocument): 0 | 1 {
	return doc.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}
