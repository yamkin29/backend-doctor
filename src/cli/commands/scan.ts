import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { ConfigError } from "../../config/errors.js";
import { loadConfig } from "../../config/load.js";
import { resolveCliOverrides } from "../../config/resolve.js";
import type { ResolvedConfig } from "../../config/types.js";
import { allProjectRules, allRules } from "../../engine/registry.js";
// Importing registers the product rules so config validation knows their ids.
import "../../rules/index.js";
import { exitCodeFor } from "../../core/exit-code.js";
import { buildReport } from "../../core/report.js";
import { runScan } from "../../core/scan.js";
import { getReporter, type ReportFormat } from "../../reporters/index.js";
import { resolveScope } from "../../scope/resolve.js";
import type { ResolvedScope, ScopeOption } from "../../scope/types.js";

export interface ScanCommandOptions {
	format: ReportFormat;
	ignore: string[];
	config?: string;
	dumpConfig?: boolean;
	scope: ScopeOption;
	base?: string;
	file: string[];
}

const REGISTERED_RULE_IDS = new Set(
	[...allRules(), ...allProjectRules()].map((rule) => rule.id),
);

export async function scanCommand(
	pathArg: string | undefined,
	opts: ScanCommandOptions,
): Promise<number> {
	const target = path.resolve(pathArg ?? process.cwd());

	// Flag-combination validation precedes any I/O (spec 015 AC-8).
	if (opts.file.length > 0 && opts.scope !== "files") {
		process.stderr.write("--file requires --scope files\n");
		return 2;
	}
	if (opts.scope === "files" && opts.file.length === 0) {
		process.stderr.write("--scope files requires at least one --file\n");
		return 2;
	}

	let config: ResolvedConfig;
	try {
		const startDir =
			fs.existsSync(target) && fs.statSync(target).isFile()
				? path.dirname(target)
				: target;
		config = await loadConfig({
			startDir,
			explicitPath: opts.config,
			knownRuleIds: REGISTERED_RULE_IDS,
		});
	} catch (error) {
		if (error instanceof ConfigError) {
			process.stderr.write(`${error.message}\n`);
			return 2;
		}
		throw error;
	}

	const resolved = resolveCliOverrides(config, { ignoreGlobs: opts.ignore });

	if (opts.dumpConfig) {
		process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
		return 0;
	}

	if (!fs.existsSync(target)) {
		process.stderr.write(`Path does not exist: ${target}\n`);
		return 2;
	}

	// Scope resolution (spec 015): a failure is a usage-environment error
	// (exit 2), never a silent fallback to a full scan.
	let scope: ResolvedScope | undefined;
	if (opts.scope !== "all") {
		const resolution = await resolveScope({
			target,
			mode: opts.scope,
			base: opts.base ?? "HEAD",
			files: opts.file.map((filePath) => path.resolve(filePath)),
		});
		if (!resolution.ok) {
			process.stderr.write(`${resolution.error}\n`);
			return 2;
		}
		scope = resolution.scope;
	}

	const result = await runScan({
		directory: target,
		ignore: resolved.ignore.files,
		config: resolved,
		scope,
	});
	const doc = buildReport(result);
	const output = getReporter(opts.format)(doc);
	if (output.length > 0) process.stdout.write(output);
	return exitCodeFor(doc);
}
