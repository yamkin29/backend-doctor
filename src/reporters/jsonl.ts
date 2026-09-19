import type { ReportDocument } from "../core/types.js";

/**
 * One diagnostic per line, nothing else — stream-friendly for agents (AC-4).
 * An empty report renders as an empty string, so stdout stays completely
 * silent.
 */
export function renderJsonl(doc: ReportDocument): string {
	if (doc.diagnostics.length === 0) return "";
	return `${doc.diagnostics.map((d) => JSON.stringify(d)).join("\n")}\n`;
}
