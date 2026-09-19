import type { Diagnostic, ProjectInfo } from "./types.js";

export interface ScanInput {
	/** Absolute path of the scan target (directory or file). */
	directory: string;
	/** Glob patterns to exclude. No-ops until the engine lands (F003). */
	ignore: string[];
}

export interface ScanResult {
	input: ScanInput;
	diagnostics: Diagnostic[];
	projects: ProjectInfo[];
}

/**
 * F001 pipeline stub: accepts input, returns zero diagnostics. The engine
 * (F003) fills the middle without changing this contract.
 */
export async function runScan(input: ScanInput): Promise<ScanResult> {
	return { input, diagnostics: [], projects: [] };
}
