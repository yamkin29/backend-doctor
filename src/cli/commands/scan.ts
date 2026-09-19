import path from "node:path";
import process from "node:process";
import { exitCodeFor } from "../../core/exit-code.js";
import { buildReport } from "../../core/report.js";
import { runScan } from "../../core/scan.js";
import { getReporter, type ReportFormat } from "../../reporters/index.js";

export interface ScanCommandOptions {
	format: ReportFormat;
	ignore: string[];
}

export async function scanCommand(
	pathArg: string | undefined,
	opts: ScanCommandOptions,
): Promise<number> {
	const directory = path.resolve(pathArg ?? process.cwd());
	const result = await runScan({ directory, ignore: opts.ignore });
	const doc = buildReport(result);
	const output = getReporter(opts.format)(doc);
	if (output.length > 0) process.stdout.write(output);
	return exitCodeFor(doc);
}
