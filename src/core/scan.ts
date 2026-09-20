import fs from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../config/types.js";
import {
	collectFiles,
	DEFAULT_EXCLUDES,
	SUPPORTED_EXTENSIONS,
} from "../engine/collect.js";
import { TsMorphParserAdapter } from "../engine/parser/ts-morph-adapter.js";
import { runProjectRules } from "../engine/project-rules.js";
import { allRules } from "../engine/registry.js";
import { runRules, sortDiagnostics } from "../engine/runner.js";
import { detectFrameworks } from "../framework/detect.js";
import { buildNestModelOrSkip } from "../framework/nest/extract.js";
import type { NestAppModel } from "../framework/nest/model.js";
// Importing registers the product rules (src/rules/index.ts is the explicit,
// greppable registry — see design 003).
import "../rules/index.js";
import type { Diagnostic, ProjectInfo, SkippedCheck } from "./types.js";

export interface ScanInput {
	/** Absolute path of the scan target (directory or file). */
	directory: string;
	/** Effective ignore globs (config ignore.files unioned with CLI --ignore). */
	ignore: string[];
	/** Fully resolved, validated config. */
	config: ResolvedConfig;
}

export interface ScanResult {
	input: ScanInput;
	diagnostics: Diagnostic[];
	projects: ProjectInfo[];
}

/**
 * F003 pipeline: collect → parse → run rules → report. File collection and
 * rule execution are deterministic; every per-file or per-rule failure is
 * recorded instead of failing the scan (constitution §8).
 */
export async function runScan(input: ScanInput): Promise<ScanResult> {
	const target = path.resolve(input.directory);

	const collected = collectFiles({
		target,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: DEFAULT_EXCLUDES,
		ignoreGlobs: input.ignore,
	});
	const adapter = new TsMorphParserAdapter();
	const { files, failures } = adapter.createProject(collected);

	const diagnostics: Diagnostic[] = [];
	const skippedChecks: SkippedCheck[] = [];

	for (const failure of failures) {
		skippedChecks.push({
			check: "read",
			reason: `${relativeTo(target, failure.filePath)}: ${failure.reason}`,
		});
	}

	const packageRoot = findPackageRoot(target);
	const detection = detectFrameworks({
		packageRoot,
		scanRoot: target,
		files,
	});
	skippedChecks.push(...detection.skippedChecks);

	// Nest app model (spec 008): built once for nest projects; a crashing
	// extraction is reported instead of failing the scan (constitution §8).
	let nestModel: NestAppModel | undefined;
	if (detection.frameworks.includes("nest")) {
		const built = buildNestModelOrSkip(files, adapter);
		nestModel = built.model;
		if (built.failure) skippedChecks.push(built.failure);
	}

	for (const file of files) {
		const outcome = runRules({
			file,
			rules: allRules(),
			config: input.config,
			adapter,
			scanRoot: target,
			detectedFrameworks: detection.frameworks,
			nestModel,
		});
		diagnostics.push(...outcome.diagnostics);
		skippedChecks.push(...outcome.skippedChecks);
	}

	// Project rules (spec 013): the second rule kind runs once per scan,
	// after the per-file loop, over the whole analyzed file set.
	const projectOutcome = runProjectRules({
		files,
		config: input.config,
		adapter,
		scanRoot: target,
		detectedFrameworks: detection.frameworks,
		packageRoot,
	});
	diagnostics.push(...projectOutcome.diagnostics);
	skippedChecks.push(...projectOutcome.skippedChecks);

	const analyzedFiles = files
		.map((file) => relativeTo(target, file.filePath))
		.sort();

	// The key is added only when the model exists, so non-nest reports carry
	// no nest field at all (spec 008 AC-7).
	const project: ProjectInfo = {
		packageRoot,
		frameworks: detection.frameworks,
		analyzedFiles,
		analyzedFileCount: analyzedFiles.length,
		complete: true,
		skippedChecks,
	};
	if (nestModel) project.nest = nestModel;

	const projects: ProjectInfo[] = [project];

	return { input, diagnostics: sortDiagnostics(diagnostics, target), projects };
}

/** Target-relative posix path, the form used in ids and report ordering. */
function relativeTo(target: string, filePath: string): string {
	return path.relative(target, filePath).split(path.sep).join("/");
}

/**
 * Nearest ancestor (or self) containing a package.json; the scan target's
 * directory is the fallback so the field is always populated (spec 003).
 */
function findPackageRoot(target: string): string {
	let dir = fs.statSync(target).isFile() ? path.dirname(target) : target;
	for (;;) {
		if (fs.existsSync(path.join(dir, "package.json"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return target;
		dir = parent;
	}
}
