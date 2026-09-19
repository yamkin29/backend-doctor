import type { ReportDocument } from "../core/types.js";
import { renderPretty } from "./pretty.js";

export type ReportFormat = "pretty" | "json" | "jsonl";

export type Reporter = (doc: ReportDocument) => string;

export function getReporter(format: ReportFormat): Reporter {
	switch (format) {
		case "pretty":
			return renderPretty;
		default:
			// Unreachable once --format choices are enforced (AC-8, T6);
			// json/jsonl reporters land in T4/T5.
			throw new Error(`Reporter not implemented yet: ${format}`);
	}
}
