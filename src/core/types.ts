export type Severity = "error" | "warn";

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

export type ScanMode = "full";

export const REPORT_SCHEMA_VERSION = 1;

export interface ProjectInfo {
	packageRoot: string;
	frameworks: string[];
	analyzedFiles: string[];
	analyzedFileCount: number;
	complete: boolean;
}

export interface ReportDocument {
	schemaVersion: typeof REPORT_SCHEMA_VERSION;
	mode: ScanMode;
	directory: string;
	diagnostics: Diagnostic[];
	projects: ProjectInfo[];
}
