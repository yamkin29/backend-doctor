import type { ScanResult } from "./scan.js";
import { REPORT_SCHEMA_VERSION, type ReportDocument } from "./types.js";

/** Builds the versioned report document shared by every reporter. */
export function buildReport(result: ScanResult): ReportDocument {
	return {
		schemaVersion: REPORT_SCHEMA_VERSION,
		mode: "full",
		directory: result.input.directory,
		diagnostics: result.diagnostics,
		projects: result.projects,
	};
}
