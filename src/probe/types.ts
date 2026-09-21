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

/** Collector settings carried by probe.attach events and findings.json (specs 019/020). */
export interface ProbeCollectorsSettings {
	blockThresholdMs: number;
	lagIntervalMs: number;
	/** Per-request db-query count that triggers the N+1 warning (spec 020). */
	n1Threshold: number;
}

/** Async-context tag on a blocking call: executing resource + trigger-chain root (spec 019). */
export interface ProbeAsyncTag {
	type: string;
	rootType: string;
}

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
	/** Present when the collectors are active in that process (spec 019). */
	collectors?: ProbeCollectorsSettings;
}

export interface ProbeDetachEvent {
	type: "probe.detach";
	timestamp: string;
	pid: number;
	reason: "exit";
	code: number;
}

/** One slow synchronous call attributed to a source location (spec 019). */
export interface ProbeBlockCallEvent {
	type: "block.call";
	timestamp: string;
	pid: number;
	api: string;
	durationMs: number;
	file: string;
	line: number | null;
	column: number | null;
	function: string | null;
	async?: ProbeAsyncTag;
}

/** Cumulative-histogram summary carried by every loop.lag event (spec 019). */
export interface ProbeLoopLagTotal {
	count: number;
	p50Ms: number;
	p99Ms: number;
	maxMs: number;
}

/** One event-loop lag window, or the final cumulative flush (spec 019). */
export interface ProbeLoopLagEvent {
	type: "loop.lag";
	timestamp: string;
	pid: number;
	periodMs: number;
	count: number;
	p50Ms: number;
	p99Ms: number;
	maxMs: number;
	final: boolean;
	total: ProbeLoopLagTotal;
}

/** One completed HTTP request/response cycle (spec 020). */
export interface ProbeHttpRequestEvent {
	type: "http.request";
	timestamp: string;
	pid: number;
	method: string;
	route: string;
	status: number;
	durationMs: number;
	dbQueries: number;
}

/** One instrumented Prisma query (spec 020). */
export interface ProbeDbQueryEvent {
	type: "db.query";
	timestamp: string;
	pid: number;
	model: string | null;
	action: string;
	durationMs: number;
	attributed: boolean;
}

/** One periodic memory sample in MB (spec 020). */
export interface ProbeMemSampleEvent {
	type: "mem.sample";
	timestamp: string;
	pid: number;
	rssMb: number;
	heapUsedMb: number;
	heapTotalMb: number;
	externalMb: number;
}

/** One observed garbage collection (spec 020). */
export interface ProbeGcPauseEvent {
	type: "gc.pause";
	timestamp: string;
	pid: number;
	kind: string;
	durationMs: number;
}

/** One aggregated blocking site in findings.json (spec 019). */
export interface FindingsCall {
	api: string;
	count: number;
	totalMs: number;
	maxMs: number;
	file: string;
	line: number | null;
	column: number | null;
	function: string | null;
	asyncRootType: string;
}

export interface FindingsLoopLag {
	windows: number;
	count: number;
	p50Ms: number;
	p99Ms: number;
	maxMs: number;
}

export interface FindingsBlocking {
	count: number;
	totalMs: number;
	calls: FindingsCall[];
}

export interface FindingsEvents {
	lines: number;
	malformedLines: number;
	attachProcesses: number;
}

/** Per-endpoint db-query counts (spec 020). */
export interface FindingsEndpointDbQueries {
	total: number;
	max: number;
	avg: number;
}

/** One aggregated endpoint row in findings.json (spec 020). */
export interface FindingsEndpoint {
	method: string;
	route: string;
	count: number;
	p50Ms: number;
	p99Ms: number;
	maxMs: number;
	statuses: Record<string, number>;
	dbQueries: FindingsEndpointDbQueries;
}

export interface FindingsHttp {
	requests: number;
	endpoints: FindingsEndpoint[];
}

/** One aggregated (model, action) row in findings.json (spec 020). */
export interface FindingsDbModel {
	model: string | null;
	action: string;
	count: number;
}

export interface FindingsDb {
	queries: number;
	totalMs: number;
	unattributed: number;
	models: FindingsDbModel[];
}

export interface FindingsGc {
	count: number;
	totalPauseMs: number;
	maxPauseMs: number;
}

export interface FindingsMemory {
	samples: number;
	peakRssMb: number;
	peakHeapUsedMb: number;
	gc: FindingsGc;
}

/** The `findings.json` document written at finalize (specs 019/020). */
export interface FindingsDocument {
	traceSchemaVersion: typeof TRACE_SCHEMA_VERSION;
	sessionId: string;
	collectors: ProbeCollectorsSettings;
	loopLag: FindingsLoopLag;
	blocking: FindingsBlocking;
	http: FindingsHttp;
	db: FindingsDb;
	memory: FindingsMemory;
	events: FindingsEvents;
	warnings: string[];
}
