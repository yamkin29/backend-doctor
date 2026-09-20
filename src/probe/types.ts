/**
 * The probe trace contract (spec 018). Versioned separately from the static
 * report's `schemaVersion`: runtime traces are their own document, consumed
 * from the session directory by F019+ tooling. Timestamps and durations vary
 * between runs by nature; what is pinned is the shape — key sets, NDJSON line
 * discipline — not the sampled values (constitution §1 note in spec 018).
 */
export const TRACE_SCHEMA_VERSION = 1;

/** How the target process ended: a normal exit code or a killing signal. */
export type ProbeExit = { code: number } | { signal: string };

export interface ProbeNodeInfo {
	version: string;
	platform: string;
	arch: string;
}

/** The `session` block of `session.json`. Key set is contract-pinned. */
export interface ProbeSession {
	id: string;
	startedAt: string;
	endedAt: string;
	command: string[];
	cwd: string;
	node: ProbeNodeInfo;
	pid: number;
	duration: { requestedSeconds: number | null; effectiveMs: number };
	filters: string[];
	exit: ProbeExit;
}

/** The whole `session.json` document. */
export interface TraceDocument {
	traceSchemaVersion: typeof TRACE_SCHEMA_VERSION;
	session: ProbeSession;
}

/** Lifecycle events the hook appends to `events.ndjson` (NDJSON, one per line). */
export interface ProbeAttachEvent {
	type: "probe.attach";
	timestamp: string;
	pid: number;
	ppid: number;
	nodeVersion: string;
	argv: string[];
}

export interface ProbeDetachEvent {
	type: "probe.detach";
	timestamp: string;
	pid: number;
	reason: "exit";
	code: number;
}
