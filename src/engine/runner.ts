import path from "node:path";
import type { ResolvedConfig } from "../config/types.js";
import type { Diagnostic, SkippedCheck } from "../core/types.js";
import { createDiagnosticId } from "./diagnostic-id.js";
import type {
	ParserAdapter,
	ReportInput,
	RuleContext,
	SourceFileView,
} from "./parser/types.js";
import type { RuleDefinition } from "./registry.js";
import { resolveSeverity } from "./severity.js";

export interface RunRulesOptions {
	file: SourceFileView;
	rules: readonly RuleDefinition[];
	config: ResolvedConfig;
	adapter: ParserAdapter;
	/** Scan target — the base for the relative paths inside diagnostic ids. */
	scanRoot: string;
	/** Framework ids detected for the project (spec 004 pack gate). */
	detectedFrameworks: readonly string[];
}

export interface RuleRunOutcome {
	diagnostics: Diagnostic[];
	skippedChecks: SkippedCheck[];
}

/**
 * Runs every enabled rule against one file (spec 003 AC-6/9). A rule is
 * enabled when every framework it declares is detected (spec 004 pack gate),
 * its id is not in `config.ignore.rules` and its severity does not resolve to
 * "off". A throwing rule never fails the scan (constitution §8): its partial
 * findings are discarded and replaced by an `internal` diagnostic plus a
 * skippedChecks entry.
 */
export function runRules(opts: RunRulesOptions): RuleRunOutcome {
	const { file, rules, config, adapter, scanRoot } = opts;
	const relativeFile = file.getRelativePathTo(scanRoot);
	const detected = new Set(opts.detectedFrameworks);
	const diagnostics: Diagnostic[] = [];
	const skippedChecks: SkippedCheck[] = [];

	for (const rule of rules) {
		// Pack gate (spec 004): a rule with declared frameworks runs only when
		// every one of them is detected. Gated-off rules are disabled by
		// design — no diagnostics, no skippedChecks (like severity "off").
		if (
			rule.frameworks !== undefined &&
			rule.frameworks.length > 0 &&
			!rule.frameworks.every((framework) => detected.has(framework))
		) {
			continue;
		}
		if (config.ignore.rules.includes(rule.id)) continue;
		const severity = resolveSeverity({
			ruleId: rule.id,
			category: rule.category,
			default: rule.severity,
			config,
		});
		if (severity === "off") continue;

		const findings: ReportInput[] = [];
		const ctx: RuleContext = {
			file,
			report: (input) => {
				findings.push(input);
			},
		};
		try {
			rule.create(ctx);
		} catch (error) {
			const reason = (error as Error).message;
			diagnostics.push({
				id: createDiagnosticId({
					file: relativeFile,
					line: 1,
					column: 1,
					rule: rule.id,
					message: `Rule "${rule.id}" crashed: ${reason}`,
				}),
				filePath: file.filePath,
				line: 1,
				column: 1,
				rule: rule.id,
				category: rule.category,
				severity: "warn",
				message: `Rule "${rule.id}" crashed: ${reason}`,
				tags: ["internal"],
			});
			skippedChecks.push({
				check: rule.id,
				reason: `${relativeFile}: ${reason}`,
			});
			continue;
		}

		for (const finding of findings) {
			diagnostics.push(
				stampDiagnostic(rule, severity, finding, {
					file,
					relativeFile,
					adapter,
				}),
			);
		}
	}

	return { diagnostics, skippedChecks };
}

function stampDiagnostic(
	rule: RuleDefinition,
	severity: "error" | "warn",
	finding: ReportInput,
	env: {
		file: SourceFileView;
		relativeFile: string;
		adapter: ParserAdapter;
	},
): Diagnostic {
	let line = finding.line ?? 1;
	let column = finding.column ?? 1;
	if (finding.node) {
		const position = env.adapter.positionOf(env.file, finding.node.getStart());
		line = position.line;
		column = position.column;
	}
	return {
		id: createDiagnosticId({
			file: env.relativeFile,
			line,
			column,
			rule: rule.id,
			message: finding.message,
		}),
		filePath: env.file.filePath,
		line,
		column,
		rule: rule.id,
		category: rule.category,
		severity,
		message: finding.message,
		tags: [],
	};
}

/**
 * Global report ordering (spec 003): relative file, line, column, rule id.
 * Keys are computed from target-relative paths so the order is independent
 * of the absolute location of the tree.
 */
export function sortDiagnostics(
	diagnostics: readonly Diagnostic[],
	scanRoot: string,
): Diagnostic[] {
	return [...diagnostics].sort((a, b) => {
		const relA = toRelative(a.filePath, scanRoot);
		const relB = toRelative(b.filePath, scanRoot);
		if (relA !== relB) return relA < relB ? -1 : 1;
		if (a.line !== b.line) return a.line - b.line;
		if (a.column !== b.column) return a.column - b.column;
		if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
		return 0;
	});
}

function toRelative(filePath: string, scanRoot: string): string {
	return path.relative(scanRoot, filePath).split(path.sep).join("/");
}
