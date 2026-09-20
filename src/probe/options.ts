/**
 * Pure parsing/validation of probe CLI options (spec 018). Filesystem checks
 * (storage root, hook file) are the runner's preflight — this module never
 * touches I/O so every usage error is unit-testable.
 */
export interface ProbeOptionsInput {
	/** The start command after `--` (commander variadic argument). */
	command: string[];
	/** Raw `--duration` value; absent means "until the child exits". */
	duration?: string;
	/** Raw `--out` value; absent means the default storage root. */
	out?: string;
	/** `--filter` values (repeatable flag). */
	filter: string[];
}

export interface ParsedProbeOptions {
	command: string[];
	durationSeconds: number | null;
	outDir: string | null;
	filters: string[];
}

export type ParseProbeResult =
	| { ok: true; value: ParsedProbeOptions }
	| { ok: false; error: string };

export function parseProbeOptions(input: ProbeOptionsInput): ParseProbeResult {
	if (input.command.length === 0) {
		return {
			ok: false,
			error:
				"no start command given — usage: backend-doctor probe [options] -- <command> [args...]",
		};
	}

	let durationSeconds: number | null = null;
	if (input.duration !== undefined) {
		const parsed = Number(input.duration);
		if (input.duration === "" || !Number.isFinite(parsed) || parsed <= 0) {
			return {
				ok: false,
				error: `--duration must be a positive number of seconds, got ${JSON.stringify(input.duration)}`,
			};
		}
		durationSeconds = parsed;
	}

	for (const glob of input.filter) {
		if (glob === "") {
			return { ok: false, error: "--filter must not be empty" };
		}
	}

	return {
		ok: true,
		value: {
			command: input.command,
			durationSeconds,
			outDir: input.out ?? null,
			filters: [...input.filter],
		},
	};
}
