import fs from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../config/types.js";
import type { Diagnostic, SkippedCheck } from "../core/types.js";
import { createDiagnosticId } from "./diagnostic-id.js";
import {
	buildImportGraph,
	findEntryFiles,
	type ImportGraph,
} from "./imports.js";
import type {
	Node,
	ParserAdapter,
	SourceFilePosition,
	SourceFileView,
} from "./parser/types.js";
import { allProjectRules, type ProjectRuleDefinition } from "./registry.js";
import { resolveSeverity } from "./severity.js";

/**
 * The project-rule pass (spec 013, design §2): the second rule kind runs
 * once per scan over the whole analyzed file set, after the per-file loop.
 * Gates, severity resolution and fail-soft isolation mirror `runRules`
 * exactly — a crashing project rule becomes an `internal` diagnostic plus
 * a skippedChecks entry, never a failed scan (constitution §8).
 */

export interface ProjectReportInput {
	/** Absolute path the finding is against (analyzed file or package.json). */
	readonly filePath: string;
	/** 1-based position; defaults to 1:1. */
	readonly line?: number;
	/** 1-based position; defaults to 1:1. */
	readonly column?: number;
	readonly message: string;
}

export interface ProjectRuleContext {
	readonly files: readonly SourceFileView[];
	/** The import graph over `files`, built once per scan. */
	readonly graph: ImportGraph;
	/** Entry files (may be empty — reachability rules stay silent then). */
	readonly entries: string[];
	/** package.json `dependencies` (name → spec, sorted; no devDependencies). */
	readonly dependencies: Readonly<Record<string, string>>;
	/** package.json `scripts` command strings. */
	readonly scripts: readonly string[];
	/** The package root the scan target belongs to (fallback: scan target). */
	readonly packageRoot: string;
	/** Target-relative posix form of an absolute path (messages, chains). */
	relativePath(filePath: string): string;
	positionOf(file: SourceFileView, node: Node): SourceFilePosition;
	report(input: ProjectReportInput): void;
}

export interface RunProjectRulesOptions {
	files: readonly SourceFileView[];
	/** Defaults to the registered product project rules. */
	rules?: readonly ProjectRuleDefinition[];
	config: ResolvedConfig;
	adapter: ParserAdapter;
	/** Scan target — the base for relative paths inside diagnostic ids. */
	scanRoot: string;
	detectedFrameworks: readonly string[];
	packageRoot: string;
}

export interface ProjectRuleRunOutcome {
	diagnostics: Diagnostic[];
	skippedChecks: SkippedCheck[];
}

export function runProjectRules(
	opts: RunProjectRulesOptions,
): ProjectRuleRunOutcome {
	const rules = opts.rules ?? allProjectRules();
	const surface = readPackageJsonSurface(opts.packageRoot);
	const graph = buildImportGraph(opts.files);
	const entries = findEntryFiles(
		opts.packageRoot,
		new Set(graph.files),
		surface,
	);
	const detected = new Set(opts.detectedFrameworks);
	const diagnostics: Diagnostic[] = [];
	const skippedChecks: SkippedCheck[] = [];
	if (surface.failure) skippedChecks.push(surface.failure);

	for (const rule of rules) {
		if (
			rule.frameworks !== undefined &&
			rule.frameworks.length > 0 &&
			!rule.frameworks.every((framework) => detected.has(framework))
		) {
			continue;
		}
		if (opts.config.ignore.rules.includes(rule.id)) continue;
		const severity = resolveSeverity({
			ruleId: rule.id,
			category: rule.category,
			default: rule.severity,
			config: opts.config,
		});
		if (severity === "off") continue;

		const findings: ProjectReportInput[] = [];
		const project: ProjectRuleContext = {
			files: opts.files,
			graph,
			entries,
			dependencies: surface.dependencies,
			scripts: surface.scripts,
			packageRoot: opts.packageRoot,
			relativePath: (filePath) => relativeTo(opts.scanRoot, filePath),
			positionOf: (file, node) =>
				opts.adapter.positionOf(file, node.getStart()),
			report: (input) => findings.push(input),
		};
		try {
			rule.analyze(project);
		} catch (error) {
			const reason = (error as Error).message;
			const message = `Rule "${rule.id}" crashed: ${reason}`;
			diagnostics.push({
				id: createDiagnosticId({
					file: ".",
					line: 1,
					column: 1,
					rule: rule.id,
					message,
				}),
				filePath: opts.scanRoot,
				line: 1,
				column: 1,
				rule: rule.id,
				category: rule.category,
				severity: "warn",
				message,
				tags: ["internal"],
			});
			skippedChecks.push({
				check: rule.id,
				reason: `project: ${reason}`,
			});
			continue;
		}

		for (const finding of findings) {
			const line = finding.line ?? 1;
			const column = finding.column ?? 1;
			const relativeFile = relativeTo(opts.scanRoot, finding.filePath);
			diagnostics.push({
				id: createDiagnosticId({
					file: relativeFile,
					line,
					column,
					rule: rule.id,
					message: finding.message,
				}),
				filePath: finding.filePath,
				line,
				column,
				rule: rule.id,
				category: rule.category,
				severity,
				message: finding.message,
				tags: [],
			});
		}
	}

	return { diagnostics, skippedChecks };
}

/**
 * Reads the package.json surface project rules need (spec 013 design §2):
 * `dependencies` keys (sorted), `scripts` command strings, and the
 * `main`/`bin` entry hints. A missing file is a normal empty surface; a
 * broken one is reported instead of failing the scan (constitution §8).
 */
export function readPackageJsonSurface(packageRoot: string): {
	dependencies: Record<string, string>;
	scripts: string[];
	main?: string;
	bin?: string | Record<string, string>;
	failure?: SkippedCheck;
} {
	const filePath = path.join(packageRoot, "package.json");
	if (!fs.existsSync(filePath)) {
		return { dependencies: {}, scripts: [] };
	}

	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch (error) {
		return {
			dependencies: {},
			scripts: [],
			failure: failureEntry(
				filePath,
				`read failed — ${(error as Error).message}`,
			),
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		return {
			dependencies: {},
			scripts: [],
			failure: failureEntry(
				filePath,
				`invalid JSON — ${(error as Error).message}`,
			),
		};
	}
	if (!isPlainObject(parsed)) {
		return {
			dependencies: {},
			scripts: [],
			failure: failureEntry(filePath, "root must be an object"),
		};
	}

	const dependencies = isPlainObject(parsed.dependencies)
		? (Object.fromEntries(
				Object.entries(parsed.dependencies)
					.filter(([, value]) => typeof value === "string")
					.sort(([a], [b]) => (a < b ? -1 : 1)),
			) as Record<string, string>)
		: {};
	const scripts = isPlainObject(parsed.scripts)
		? Object.values(parsed.scripts).filter(
				(value): value is string => typeof value === "string",
			)
		: [];
	const main = typeof parsed.main === "string" ? parsed.main : undefined;
	const bin =
		typeof parsed.bin === "string"
			? parsed.bin
			: isPlainObject(parsed.bin)
				? (Object.fromEntries(
						Object.entries(parsed.bin).filter(
							([, value]) => typeof value === "string",
						),
					) as Record<string, string>)
				: undefined;

	return { dependencies, scripts, main, bin };
}

function failureEntry(filePath: string, reason: string): SkippedCheck {
	// The surface is always <packageRoot>/package.json, so the basename is
	// the deterministic, machine-independent form for the report.
	void filePath;
	return { check: "package-surface", reason: `package.json: ${reason}` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativeTo(target: string, filePath: string): string {
	const relative = path.relative(target, filePath).split(path.sep).join("/");
	return relative === "" ? "." : relative;
}
