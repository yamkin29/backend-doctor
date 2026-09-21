/**
 * Pure analysis of a probe session's events (spec 019): the same
 * events.ndjson always yields byte-identical findings.json. Values inside
 * describe a real execution and vary between runs; what is deterministic is
 * the derivation — aggregation keys, sort order, cap, and merge rules
 * (constitution §1 note in spec 018).
 */
import type { ProbeCollectors } from "./options.js";
import {
	type FindingsCall,
	type FindingsDb,
	type FindingsDbModel,
	type FindingsDocument,
	type FindingsEndpoint,
	type FindingsMemory,
	type ProbeBlockCallEvent,
	type ProbeDbQueryEvent,
	type ProbeGcPauseEvent,
	type ProbeHttpRequestEvent,
	type ProbeLoopLagEvent,
	type ProbeLoopLagTotal,
	type ProbeMemSampleEvent,
	TRACE_SCHEMA_VERSION,
} from "./types.js";

const CALLS_CAP = 50;
const ENDPOINTS_CAP = 50;
const MODELS_CAP = 50;
const CAP_WARNING = "blocking calls capped at 50 groups";
const ENDPOINTS_CAP_WARNING = "http endpoints capped at 50 groups";
const MODELS_CAP_WARNING = "db models capped at 50 groups";
export const NO_ATTACH_WARNING =
	"no probe events recorded — the target may not be Node or the hook did not load";

export interface FindingsInput {
	sessionId: string;
	collectors: ProbeCollectors;
	/** The raw contents of the session's events.ndjson. */
	eventsText: string;
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlockCall(event: unknown): event is ProbeBlockCallEvent {
	if (!isRecord(event)) return false;
	return (
		event.type === "block.call" &&
		typeof event.api === "string" &&
		typeof event.durationMs === "number" &&
		typeof event.file === "string"
	);
}

function isLoopLag(event: unknown): event is ProbeLoopLagEvent {
	if (!isRecord(event) || !isRecord(event.total)) return false;
	return (
		event.type === "loop.lag" &&
		typeof event.pid === "number" &&
		typeof event.final === "boolean" &&
		typeof event.total.count === "number"
	);
}

function isHttpRequest(event: unknown): event is ProbeHttpRequestEvent {
	if (!isRecord(event)) return false;
	return (
		event.type === "http.request" &&
		typeof event.method === "string" &&
		typeof event.route === "string" &&
		typeof event.status === "number" &&
		typeof event.durationMs === "number" &&
		typeof event.dbQueries === "number"
	);
}

function isDbQuery(event: unknown): event is ProbeDbQueryEvent {
	if (!isRecord(event)) return false;
	return (
		event.type === "db.query" &&
		(event.model === null || typeof event.model === "string") &&
		typeof event.action === "string" &&
		typeof event.durationMs === "number"
	);
}

function isMemSample(event: unknown): event is ProbeMemSampleEvent {
	if (!isRecord(event)) return false;
	return (
		event.type === "mem.sample" &&
		typeof event.rssMb === "number" &&
		typeof event.heapUsedMb === "number"
	);
}

function isGcPause(event: unknown): event is ProbeGcPauseEvent {
	if (!isRecord(event)) return false;
	return (
		event.type === "gc.pause" &&
		typeof event.kind === "string" &&
		typeof event.durationMs === "number"
	);
}

/**
 * totalMs desc, then file asc, line asc, column asc, function asc,
 * rootType asc, api asc — a full tie-break chain so equal-total rows still
 * have one deterministic order.
 */
function compareCalls(a: FindingsCall, b: FindingsCall): number {
	if (a.totalMs !== b.totalMs) return b.totalMs - a.totalMs;
	if (a.file !== b.file) return a.file < b.file ? -1 : 1;
	const lineA = a.line ?? -1;
	const lineB = b.line ?? -1;
	if (lineA !== lineB) return lineA - lineB;
	const columnA = a.column ?? -1;
	const columnB = b.column ?? -1;
	if (columnA !== columnB) return columnA - columnB;
	const functionA = a.function ?? "";
	const functionB = b.function ?? "";
	if (functionA !== functionB) return functionA < functionB ? -1 : 1;
	if (a.asyncRootType !== b.asyncRootType) {
		return a.asyncRootType < b.asyncRootType ? -1 : 1;
	}
	if (a.api !== b.api) return a.api < b.api ? -1 : 1;
	return 0;
}

export function buildFindings(input: FindingsInput): FindingsDocument {
	const lines = input.eventsText.split("\n").filter((line) => line.length > 0);

	let malformedLines = 0;
	const attachPids = new Set<number>();
	const blocks: ProbeBlockCallEvent[] = [];
	const lagEvents: ProbeLoopLagEvent[] = [];
	const httpRequests: ProbeHttpRequestEvent[] = [];
	const dbQueries: ProbeDbQueryEvent[] = [];
	const memSamples: ProbeMemSampleEvent[] = [];
	const gcPauses: ProbeGcPauseEvent[] = [];
	for (const line of lines) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			malformedLines++;
			continue;
		}
		if (!isRecord(parsed)) {
			malformedLines++;
			continue;
		}
		if (parsed.type === "probe.attach" && typeof parsed.pid === "number") {
			attachPids.add(parsed.pid);
		} else if (isBlockCall(parsed)) {
			blocks.push(parsed);
		} else if (isLoopLag(parsed)) {
			lagEvents.push(parsed);
		} else if (isHttpRequest(parsed)) {
			httpRequests.push(parsed);
		} else if (isDbQuery(parsed)) {
			dbQueries.push(parsed);
		} else if (isMemSample(parsed)) {
			memSamples.push(parsed);
		} else if (isGcPause(parsed)) {
			gcPauses.push(parsed);
		}
	}

	// Aggregate per (api, file, line, column, function, asyncRootType); the
	// same site under different async roots is deliberately different rows.
	const groups = new Map<string, FindingsCall>();
	for (const block of blocks) {
		const rootType = block.async?.rootType ?? "";
		const key = JSON.stringify([
			block.api,
			block.file,
			block.line,
			block.column,
			block.function,
			rootType,
		]);
		const group = groups.get(key);
		if (group === undefined) {
			groups.set(key, {
				api: block.api,
				count: 1,
				totalMs: block.durationMs,
				maxMs: block.durationMs,
				file: block.file,
				line: block.line,
				column: block.column,
				function: block.function,
				asyncRootType: rootType,
			});
		} else {
			group.count++;
			group.totalMs = round3(group.totalMs + block.durationMs);
			group.maxMs = Math.max(group.maxMs, block.durationMs);
		}
	}
	const sorted = [...groups.values()].sort(compareCalls);
	const capped = sorted.length > CALLS_CAP;

	// loopLag: the last total per pid (a process killed before its final
	// flush contributes its last window's total), merged across pids —
	// exact sums and max, count-weighted percentile averages.
	let windows = 0;
	const totalsByPid = new Map<number, ProbeLoopLagTotal>();
	for (const lag of lagEvents) {
		if (!lag.final) windows++;
		totalsByPid.set(lag.pid, lag.total);
	}
	let sampleCount = 0;
	let maxLagMs = 0;
	let weighted50 = 0;
	let weighted99 = 0;
	for (const total of totalsByPid.values()) {
		sampleCount += total.count;
		maxLagMs = Math.max(maxLagMs, total.maxMs);
		weighted50 += total.p50Ms * total.count;
		weighted99 += total.p99Ms * total.count;
	}

	// ---- http: endpoints aggregated per (method, route) ----
	const warnings: string[] = [];

	interface EndpointGroup {
		method: string;
		route: string;
		durations: number[];
		statuses: Map<string, number>;
		dbTotal: number;
		dbMax: number;
	}
	const endpointGroups = new Map<string, EndpointGroup>();
	for (const request of httpRequests) {
		const key = JSON.stringify([request.method, request.route]);
		const group = endpointGroups.get(key);
		if (group === undefined) {
			endpointGroups.set(key, {
				method: request.method,
				route: request.route,
				durations: [request.durationMs],
				statuses: new Map([[String(request.status), 1]]),
				dbTotal: request.dbQueries,
				dbMax: request.dbQueries,
			});
		} else {
			group.durations.push(request.durationMs);
			const code = String(request.status);
			group.statuses.set(code, (group.statuses.get(code) ?? 0) + 1);
			group.dbTotal += request.dbQueries;
			group.dbMax = Math.max(group.dbMax, request.dbQueries);
		}
	}

	/** Exact nearest-rank percentile over an ascending-sorted list. */
	function nearestRank(sorted: number[], p: number): number {
		const rank = Math.ceil((p / 100) * sorted.length);
		return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1] ?? 0;
	}

	const allEndpoints: FindingsEndpoint[] = [...endpointGroups.values()]
		.map((group) => {
			const durations = [...group.durations].sort((a, b) => a - b);
			const statuses: Record<string, number> = {};
			for (const code of [...group.statuses.keys()].sort(
				(a, b) => Number(a) - Number(b),
			)) {
				statuses[code] = group.statuses.get(code) ?? 0;
			}
			return {
				method: group.method,
				route: group.route,
				count: durations.length,
				p50Ms: round3(nearestRank(durations, 50)),
				p99Ms: round3(nearestRank(durations, 99)),
				maxMs: durations[durations.length - 1] ?? 0,
				statuses,
				dbQueries: {
					total: group.dbTotal,
					max: group.dbMax,
					avg: round3(group.dbTotal / durations.length),
				},
			};
		})
		.sort((a, b) => {
			if (a.p99Ms !== b.p99Ms) return b.p99Ms - a.p99Ms;
			if (a.method !== b.method) return a.method < b.method ? -1 : 1;
			if (a.route !== b.route) return a.route < b.route ? -1 : 1;
			return 0;
		});
	const endpointsCapped = allEndpoints.length > ENDPOINTS_CAP;
	if (endpointsCapped) warnings.push(ENDPOINTS_CAP_WARNING);
	// N+1 warnings iterate the full sorted list, so the cap never hides one.
	for (const endpoint of allEndpoints) {
		if (endpoint.dbQueries.max >= input.collectors.n1Threshold) {
			warnings.push(
				`endpoint ${endpoint.method} ${endpoint.route} saw up to ${endpoint.dbQueries.max} db queries in one request (possible N+1)`,
			);
		}
	}

	// ---- db: totals plus (model, action) rows ----
	const modelGroups = new Map<string, FindingsDbModel>();
	for (const query of dbQueries) {
		const key = JSON.stringify([query.model, query.action]);
		const group = modelGroups.get(key);
		if (group === undefined) {
			modelGroups.set(key, {
				model: query.model,
				action: query.action,
				count: 1,
			});
		} else {
			group.count++;
		}
	}
	const allModels = [...modelGroups.values()].sort((a, b) => {
		if (a.count !== b.count) return b.count - a.count;
		const modelA = a.model ?? "";
		const modelB = b.model ?? "";
		if (modelA !== modelB) return modelA < modelB ? -1 : 1;
		if (a.action !== b.action) return a.action < b.action ? -1 : 1;
		return 0;
	});
	const modelsCapped = allModels.length > MODELS_CAP;
	if (modelsCapped) warnings.push(MODELS_CAP_WARNING);

	const db: FindingsDb = {
		queries: dbQueries.length,
		totalMs: round3(
			dbQueries.reduce((sum, query) => sum + query.durationMs, 0),
		),
		unattributed: dbQueries.filter((query) => query.attributed !== true).length,
		models: modelsCapped ? allModels.slice(0, MODELS_CAP) : allModels,
	};

	// ---- memory: exact peaks and gc totals ----
	let peakRssMb = 0;
	let peakHeapUsedMb = 0;
	for (const sample of memSamples) {
		peakRssMb = Math.max(peakRssMb, sample.rssMb);
		peakHeapUsedMb = Math.max(peakHeapUsedMb, sample.heapUsedMb);
	}
	let gcCount = 0;
	let gcTotalMs = 0;
	let gcMaxMs = 0;
	for (const pause of gcPauses) {
		gcCount++;
		gcTotalMs += pause.durationMs;
		gcMaxMs = Math.max(gcMaxMs, pause.durationMs);
	}
	const memory: FindingsMemory = {
		samples: memSamples.length,
		peakRssMb: round3(peakRssMb),
		peakHeapUsedMb: round3(peakHeapUsedMb),
		gc: {
			count: gcCount,
			totalPauseMs: round3(gcTotalMs),
			maxPauseMs: round3(gcMaxMs),
		},
	};

	if (attachPids.size === 0) warnings.unshift(NO_ATTACH_WARNING);
	if (capped) warnings.push(CAP_WARNING);

	return {
		traceSchemaVersion: TRACE_SCHEMA_VERSION,
		sessionId: input.sessionId,
		collectors: input.collectors,
		loopLag: {
			windows,
			count: sampleCount,
			p50Ms: sampleCount > 0 ? round3(weighted50 / sampleCount) : 0,
			p99Ms: sampleCount > 0 ? round3(weighted99 / sampleCount) : 0,
			maxMs: maxLagMs,
		},
		blocking: {
			count: blocks.length,
			totalMs: round3(blocks.reduce((sum, block) => sum + block.durationMs, 0)),
			calls: capped ? sorted.slice(0, CALLS_CAP) : sorted,
		},
		http: {
			requests: httpRequests.length,
			endpoints: endpointsCapped
				? allEndpoints.slice(0, ENDPOINTS_CAP)
				: allEndpoints,
		},
		db,
		memory,
		events: {
			lines: lines.length,
			malformedLines,
			attachProcesses: attachPids.size,
		},
		warnings,
	};
}
