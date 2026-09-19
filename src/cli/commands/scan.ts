import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { ConfigError } from "../../config/errors.js";
import { loadConfig } from "../../config/load.js";
import { resolveCliOverrides } from "../../config/resolve.js";
import type { ResolvedConfig } from "../../config/types.js";
import { allRules } from "../../engine/registry.js";
// Importing registers the product rules so config validation knows their ids.
import "../../rules/index.js";
import { exitCodeFor } from "../../core/exit-code.js";
import { buildReport } from "../../core/report.js";
import { runScan } from "../../core/scan.js";
import { getReporter, type ReportFormat } from "../../reporters/index.js";

export interface ScanCommandOptions {
	format: ReportFormat;
	ignore: string[];
	config?: string;
	dumpConfig?: boolean;
}

const REGISTERED_RULE_IDS = new Set(allRules().map((rule) => rule.id));

export async function scanCommand(
	pathArg: string | undefined,
	opts: ScanCommandOptions,
): Promise<number> {
	const target = path.resolve(pathArg ?? process.cwd());

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

	const result = await runScan({
		directory: target,
		ignore: resolved.ignore.files,
		config: resolved,
	});
	const doc = buildReport(result);
	const output = getReporter(opts.format)(doc);
	if (output.length > 0) process.stdout.write(output);
	return exitCodeFor(doc);
}
