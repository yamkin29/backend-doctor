import path from "node:path";
import type { Diagnostic, ReportDocument } from "../core/types.js";
import type { BlockingMode, ReportSurfaces, SurfaceOptions } from "./types.js";

/**
 * Hidden HTML comment identifying the sticky summary. The poster updates
 * the existing comment bearing this marker instead of stacking a new one.
 */
export const STICKY_MARKER = "<!-- backend-doctor:sticky -->";

const plural = (n: number, word: string): string =>
	n === 1 ? word : `${word}s`;

function counts(diagnostics: Diagnostic[]): {
	errors: number;
	warnings: number;
} {
	let errors = 0;
	for (const d of diagnostics) {
		if (d.severity === "error") errors += 1;
	}
	return { errors, warnings: diagnostics.length - errors };
}

/**
 * The blocking verdict (spec 016 AC-6): exit 1 iff the configured threshold
 * is hit. `none` never fails; `error` fails on ≥1 error-severity finding;
 * `warn` fails on ≥1 finding of any severity. Mirrors `scan`'s discipline
 * that exit 1 means "diagnostics found".
 */
export function blockingExitCode(
	doc: ReportDocument,
	blocking: BlockingMode,
): 0 | 1 {
	if (blocking === "none") return 0;
	const { errors, warnings } = counts(doc.diagnostics);
	if (blocking === "error") return errors > 0 ? 1 : 0;
	return errors + warnings > 0 ? 1 : 0;
}

/**
 * Repo-relative posix form of a diagnostic path: relative to the workspace
 * root when the file lives inside it, else relative to the scan directory,
 * else verbatim (GitHub rejects out-of-repo paths — that surface then fails
 * loud at posting time).
 */
function relativePath(
	filePath: string,
	doc: ReportDocument,
	opts: SurfaceOptions,
): string {
	const bases = [opts.workspaceRoot, doc.directory];
	for (const base of bases) {
		if (!base) continue;
		const rel = path.relative(base, filePath);
		if (rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel)) {
			return rel.replace(/\\/g, "/");
		}
	}
	return filePath.replace(/\\/g, "/");
}

function scopeLine(doc: ReportDocument): string {
	const base =
		doc.mode === "changed" || doc.mode === "lines"
			? doc.scope?.base
			: undefined;
	const suffix = base ? `, base: ${base}` : "";
	return `scope: ${doc.mode}${suffix}`;
}

function skippedNote(doc: ReportDocument): string[] {
	const seen = new Set<string>();
	for (const project of doc.projects) {
		for (const skipped of project.skippedChecks) {
			seen.add(`${skipped.check}: ${skipped.reason}`);
		}
	}
	if (seen.size === 0) return [];
	const lines = [
		`> ⚠️ ${seen.size} ${plural(seen.size, "check")} skipped in this scope:`,
	];
	for (const entry of seen) lines.push(`> - ${entry}`);
	return lines;
}

function stickyBody(doc: ReportDocument, opts: SurfaceOptions): string {
	const { errors, warnings } = counts(doc.diagnostics);
	const lines: string[] = [
		"## backend-doctor report",
		"",
		`**${errors} ${plural(errors, "error")}, ${warnings} ${plural(warnings, "warning")}** found (${scopeLine(doc)}).`,
	];

	if (doc.diagnostics.length === 0) {
		lines.push("", "🎉 No findings in this scope.");
	} else {
		lines.push("", "<details><summary>Findings by file</summary>", "");
		let currentFile: string | undefined;
		for (const d of doc.diagnostics) {
			const rel = relativePath(d.filePath, doc, opts);
			if (rel !== currentFile) {
				currentFile = rel;
				lines.push("", `### ${rel}`);
			}
			lines.push(`- L${d.line} — \`${d.rule}\` (${d.severity}): ${d.message}`);
		}
		lines.push("", "</details>");
	}

	lines.push("");
	lines.push(...skippedNote(doc));

	const reviewCount = opts.reviewComments
		? Math.min(doc.diagnostics.length, opts.maxReviewComments)
		: 0;
	if (doc.diagnostics.length > reviewCount && reviewCount > 0) {
		const omitted = doc.diagnostics.length - reviewCount;
		lines.push(
			`> Showing ${reviewCount} of ${doc.diagnostics.length} inline comments — ${omitted} more omitted.`,
		);
	}

	lines.push("", STICKY_MARKER);
	return `${lines.join("\n")}\n`;
}

/**
 * Builds the exact payloads the posting step sends (spec 016 AC-5): a pure
 * function of the report and the options, so identical input yields a
 * byte-identical envelope (AC-14).
 */
export function buildSurfaces(
	doc: ReportDocument,
	opts: SurfaceOptions,
): ReportSurfaces {
	const envelope: ReportSurfaces = {};

	if (opts.comment) {
		envelope.comment = { body: stickyBody(doc, opts) };
	}

	if (opts.reviewComments) {
		const { context } = opts;
		envelope.reviewComments = doc.diagnostics
			.slice(0, Math.max(0, opts.maxReviewComments))
			.map((d) => ({
				commit_id: context.headSha,
				path: relativePath(d.filePath, doc, opts),
				line: d.line,
				side: "RIGHT" as const,
				body: `**${d.rule}** (${d.severity}): ${d.message}`,
			}));
	}

	if (opts.commitStatus) {
		const { context } = opts;
		const { errors, warnings } = counts(doc.diagnostics);
		const failed = blockingExitCode(doc, opts.blocking) === 1;
		envelope.status = {
			state: failed ? "failure" : "success",
			description: `${errors} ${plural(errors, "error")}, ${warnings} ${plural(warnings, "warning")} (blocking: ${opts.blocking})`,
			context: "backend-doctor",
			target_url: `${context.serverUrl}/${context.repository}/actions/runs/${context.runId}`,
		};
	}

	return envelope;
}
