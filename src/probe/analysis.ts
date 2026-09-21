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
	type FindingsDocument,
	type ProbeBlockCallEvent,
	type ProbeLoopLagEvent,
	type ProbeLoopLagTotal,
	TRACE_SCHEMA_VERSION,
} from "./types.js";

const CALLS_CAP = 50;
const CAP_WARNING = "blocking calls capped at 50 groups";
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

	const warnings: string[] = [];
	if (attachPids.size === 0) warnings.push(NO_ATTACH_WARNING);
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
		events: {
			lines: lines.length,
			malformedLines,
			attachProcesses: attachPids.size,
		},
		warnings,
	};
}
