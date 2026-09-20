export type Severity = "error" | "warn";

import type { NestAppModel } from "../framework/nest/model.js";

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

export type ScanMode = "full";

export const REPORT_SCHEMA_VERSION = 1;

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
	directory: string;
	diagnostics: Diagnostic[];
	projects: ProjectInfo[];
}
