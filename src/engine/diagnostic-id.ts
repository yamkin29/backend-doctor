import { createHash } from "node:crypto";

export interface DiagnosticIdInput {
	/** Path relative to the scan target (posix separators). */
	file: string;
	/** 1-based line. */
	line: number;
	/** 1-based column. */
	column: number;
	rule: string;
	message: string;
}

/**
 * Deterministic diagnostic id (constitution §5, spec 003 AC-4):
 * `<file>::<line>:<col>::<rule>::<8-char sha256 of the full tuple>`. Pure
 * function — the same inputs always yield the same id, so CI conversations
 * can reference a finding across runs.
 */
export function createDiagnosticId(input: DiagnosticIdInput): string {
	const prefix = `${input.file}::${input.line}:${input.column}::${input.rule}`;
	const digest = createHash("sha256")
		.update(`${prefix}::${input.message}`)
		.digest("hex")
		.slice(0, 8);
	return `${prefix}::${digest}`;
}
