import type { ResolvedConfig } from "../config/types.js";
import type { Diagnostic, ProjectInfo } from "./types.js";

export interface ScanInput {
	/** Absolute path of the scan target (directory or file). */
	directory: string;
	/** Effective ignore globs (config ignore.files unioned with CLI --ignore). */
	ignore: string[];
	/** Fully resolved, validated config. Consumed by the engine (F003). */
	config: ResolvedConfig;
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
