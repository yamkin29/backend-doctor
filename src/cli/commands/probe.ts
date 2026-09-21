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
 * Collector knobs arrive as env (spec 019) and go through the same pure
 * validation — garbage env is a usage error, not a silent default.
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
		blockThresholdMs: process.env.BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS,
		lagIntervalMs: process.env.BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS,
	});
	if (!parsed.ok) {
		process.stderr.write(`${parsed.error}\n`);
		return 2;
	}
	return runProbe({ parsed: parsed.value, cwd: process.cwd() });
}
