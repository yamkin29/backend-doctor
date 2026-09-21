/**
 * Pure parsing/validation of probe CLI options (spec 018) and collector
 * knobs (spec 019). Filesystem checks (storage root, hook file) are the
 * runner's preflight — this module never touches I/O so every usage error is
 * unit-testable. Collector knobs arrive as raw env strings; the parent
 * validates them before spawn so garbage is a loud usage error, not a silent
 * default.
 */
import type { ProbeCollectorsSettings } from "./types.js";

/** The parsed collector knobs; shape is the trace contract's settings block. */
export type ProbeCollectors = ProbeCollectorsSettings;

export const DEFAULT_BLOCK_THRESHOLD_MS = 20;
export const DEFAULT_LAG_INTERVAL_MS = 1000;
export const DEFAULT_N1_THRESHOLD = 20;
export const MIN_LAG_INTERVAL_MS = 50;

export interface ProbeOptionsInput {
	/** The start command after `--` (commander variadic argument). */
	command: string[];
	/** Raw `--duration` value; absent means "until the child exits". */
	duration?: string;
	/** Raw `--out` value; absent means the default storage root. */
	out?: string;
	/** `--filter` values (repeatable flag). */
	filter: string[];
	/** Raw `BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS` env value. */
	blockThresholdMs?: string;
	/** Raw `BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS` env value. */
	lagIntervalMs?: string;
	/** Raw `BACKEND_DOCTOR_PROBE_N1_THRESHOLD` env value (spec 020). */
	n1Threshold?: string;
}

export interface ParsedProbeOptions {
	command: string[];
	durationSeconds: number | null;
	outDir: string | null;
	filters: string[];
	collectors: ProbeCollectors;
}

export type ParseProbeResult =
	| { ok: true; value: ParsedProbeOptions }
	| { ok: false; error: string };

function parsePositiveMs(
	raw: string,
	envName: string,
): { ok: true; ms: number } | { ok: false; error: string } {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return {
			ok: false,
			error: `${envName} must be a positive number of milliseconds, got ${JSON.stringify(raw)}`,
		};
	}
	return { ok: true, ms: parsed };
}

function parseFloorMs(
	raw: string,
	envName: string,
	minMs: number,
): { ok: true; ms: number } | { ok: false; error: string } {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < minMs) {
		return {
			ok: false,
			error: `${envName} must be a number of milliseconds >= ${minMs}, got ${JSON.stringify(raw)}`,
		};
	}
	return { ok: true, ms: parsed };
}

function parsePositiveCount(
	raw: string,
	envName: string,
): { ok: true; count: number } | { ok: false; error: string } {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return {
			ok: false,
			error: `${envName} must be a positive number, got ${JSON.stringify(raw)}`,
		};
	}
	return { ok: true, count: parsed };
}

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

	let blockThresholdMs = DEFAULT_BLOCK_THRESHOLD_MS;
	if (input.blockThresholdMs !== undefined) {
		const knob = parsePositiveMs(
			input.blockThresholdMs,
			"BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS",
		);
		if (!knob.ok) {
			return { ok: false, error: knob.error };
		}
		blockThresholdMs = knob.ms;
	}

	let lagIntervalMs = DEFAULT_LAG_INTERVAL_MS;
	if (input.lagIntervalMs !== undefined) {
		const knob = parseFloorMs(
			input.lagIntervalMs,
			"BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS",
			MIN_LAG_INTERVAL_MS,
		);
		if (!knob.ok) {
			return { ok: false, error: knob.error };
		}
		lagIntervalMs = knob.ms;
	}

	let n1Threshold = DEFAULT_N1_THRESHOLD;
	if (input.n1Threshold !== undefined) {
		const knob = parsePositiveCount(
			input.n1Threshold,
			"BACKEND_DOCTOR_PROBE_N1_THRESHOLD",
		);
		if (!knob.ok) {
			return { ok: false, error: knob.error };
		}
		n1Threshold = knob.count;
	}

	return {
		ok: true,
		value: {
			command: input.command,
			durationSeconds,
			outDir: input.out ?? null,
			filters: [...input.filter],
			collectors: { blockThresholdMs, lagIntervalMs, n1Threshold },
		},
	};
}
