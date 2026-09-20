import type { ScanResult } from "./scan.js";
import { REPORT_SCHEMA_VERSION, type ReportDocument } from "./types.js";

/**
 * Builds the versioned report document shared by every reporter. The mode
 * mirrors the active scope (spec 015); `scope.base` rides along only for
 * `changed`/`lines`, keeping default reports byte-identical to the pre-015
 * shape.
 */
export function buildReport(result: ScanResult): ReportDocument {
	const scope = result.input.scope;
	return {
		schemaVersion: REPORT_SCHEMA_VERSION,
		mode: scope ? scope.mode : "full",
		...(scope?.mode === "changed" || scope?.mode === "lines"
			? { scope: { base: scope.base ?? "HEAD" } }
			: {}),
		directory: result.input.directory,
		diagnostics: result.diagnostics,
		projects: result.projects,
	};
}
