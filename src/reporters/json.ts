import type { ReportDocument } from "../core/types.js";

export function renderJson(doc: ReportDocument): string {
	return `${JSON.stringify(doc, null, "\t")}\n`;
}
