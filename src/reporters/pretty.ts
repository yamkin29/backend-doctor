import path from "node:path";
import pc from "picocolors";
import type { Diagnostic, ReportDocument } from "../core/types.js";

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function renderDiagnostic(doc: ReportDocument, d: Diagnostic): string {
	const rel = path.relative(doc.directory, d.filePath);
	const severity = d.severity === "error" ? pc.red("error") : pc.yellow("warn");
	return `${rel}:${d.line}:${d.column}  ${severity}  ${d.rule}  ${d.message}`;
}

export function renderPretty(doc: ReportDocument): string {
	const lines: string[] = [];
	lines.push(`${pc.bold("backend-doctor")} scan — ${doc.mode} mode`);
	lines.push(`Directory: ${doc.directory}`);

	// One additive line, only when a framework was detected (spec 004) —
	// framework-less reports stay byte-identical to the pre-004 output.
	const frameworks = doc.projects[0]?.frameworks ?? [];
	if (frameworks.length > 0) {
		lines.push(`Frameworks: ${frameworks.join(", ")}`);
	}

	const errors = doc.diagnostics.filter((d) => d.severity === "error").length;
	const warnings = doc.diagnostics.length - errors;

	if (doc.diagnostics.length > 0) {
		lines.push("");
		for (const d of doc.diagnostics) lines.push(renderDiagnostic(doc, d));
	}

	lines.push("");
	lines.push(
		`Summary: ${plural(errors, "error")}, ${plural(warnings, "warning")} (${plural(doc.diagnostics.length, "issue")})`,
	);
	return `${lines.join("\n")}\n`;
}
