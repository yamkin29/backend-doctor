import type { ReportDocument } from "../core/types.js";
import { renderJson } from "./json.js";
import { renderPretty } from "./pretty.js";

export type ReportFormat = "pretty" | "json" | "jsonl";

export type Reporter = (doc: ReportDocument) => string;

export function getReporter(format: ReportFormat): Reporter {
	switch (format) {
		case "pretty":
			return renderPretty;
		case "json":
			return renderJson;
		default:
			// jsonl lands in T5; unreachable once --format choices are enforced
			// (AC-8, T6).
			throw new Error(`Reporter not implemented yet: ${format}`);
	}
}
