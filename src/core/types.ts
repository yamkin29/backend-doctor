export type Severity = "error" | "warn";

import type { NestAppModel } from "../framework/nest/model.js";
import type { ScopeMode } from "../scope/types.js";

export const DIAGNOSTIC_CATEGORIES = [
	"Bugs",
	"Correctness",
	"Performance",
	"Security",
	"Architecture",
	"Maintainability",
	"Configuration",
	"Runtime",
] as const;

export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number];

export interface Diagnostic {
	/** Deterministic id: <file>::<line>:<col>::<rule>::<occurrence digest>. */
	id: string;
	filePath: string;
	line: number;
	column: number;
	rule: string;
	category: DiagnosticCategory;
	severity: Severity;
	message: string;
	tags: string[];
}

/**
 * A file or check that could not run but did not fail the scan
 * (constitution §8 — fail soft, report loud).
 */
export interface SkippedCheck {
	/** Stable scope: "read" for source-loading failures, the rule id for crashed rules. */
	check: string;
	/** Human-readable reason; starts with the target-relative file path when known. */
	reason: string;
}

/**
 * The report's `mode`: `"full"` for the pre-015 whole-tree scan, otherwise
 * the active partial scope (spec 015).
 */
export type ScanMode = "full" | ScopeMode;

export const REPORT_SCHEMA_VERSION = 1;

/**
 * Trace provenance for the combined report (spec 021): present only when a
 * scan merged a probe session via `--trace`. Additive — reports without a
 * trace carry no `runtime` key at all (schemaVersion stays 1).
 */
export interface RuntimeProvenance {
	sessionDir: string;
	traceSchemaVersion: 1;
}

export interface ProjectInfo {
	packageRoot: string;
	frameworks: string[];
	analyzedFiles: string[];
	analyzedFileCount: number;
	complete: boolean;
	skippedChecks: SkippedCheck[];
	/**
	 * Nest application model (spec 008); present only when the `nest`
	 * framework was detected and extraction succeeded.
	 */
	nest?: NestAppModel;
}

export interface ReportDocument {
	schemaVersion: typeof REPORT_SCHEMA_VERSION;
	mode: ScanMode;
	/**
	 * Present only for `changed`/`lines` scopes (spec 015): the resolved
	 * `--base` the diff was computed against, so a report can be reproduced.
	 */
	scope?: { base: string };
	directory: string;
	diagnostics: Diagnostic[];
	projects: ProjectInfo[];
	/**
	 * Present only when a probe session was merged via `scan --trace`
	 * (spec 021); appended as the document's last key.
	 */
	runtime?: RuntimeProvenance;
}
