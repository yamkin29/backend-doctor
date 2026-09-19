import type { ReportDocument } from "../core/types.js";
import { renderJson } from "./json.js";
import { renderJsonl } from "./jsonl.js";
import { renderPretty } from "./pretty.js";

export type ReportFormat = "pretty" | "json" | "jsonl";

export type Reporter = (doc: ReportDocument) => string;

export function getReporter(format: ReportFormat): Reporter {
	switch (format) {
		case "pretty":
			return renderPretty;
		case "json":
			return renderJson;
		case "jsonl":
			return renderJsonl;
	}
}
