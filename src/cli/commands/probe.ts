import process from "node:process";
import { parseProbeOptions } from "../../probe/options.js";
import { runProbe } from "../../probe/runner.js";

export interface ProbeCommandOptions {
	duration?: string;
	out?: string;
	filter: string[];
}

/**
 * Thin CLI surface over runProbe: pure-option validation errors are usage
 * errors (exit 2, stderr only); everything else is the runner's contract.
 */
export async function probeCommand(
	command: string[],
	opts: ProbeCommandOptions,
): Promise<number> {
	const parsed = parseProbeOptions({
		command,
		duration: opts.duration,
		out: opts.out,
		filter: opts.filter,
	});
	if (!parsed.ok) {
		process.stderr.write(`${parsed.error}\n`);
		return 2;
	}
	return runProbe({ parsed: parsed.value, cwd: process.cwd() });
}
