import { expect, test } from "vitest";
import { buildFindings } from "../../../src/probe/analysis.js";
import type { ProbeCollectors } from "../../../src/probe/options.js";

const collectors: ProbeCollectors = {
	blockThresholdMs: 20,
	lagIntervalMs: 1000,
	n1Threshold: 20,
};

function eventsText(...events: Array<Record<string, unknown>>): string {
	if (events.length === 0) return "";
	return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

interface Overloads {
	[key: string]: unknown;
}

function blockEvent(overrides: Overloads = {}): Record<string, unknown> {
	return {
		type: "block.call",
		timestamp: "2026-09-21T10:15:30.200Z",
		pid: 1,
		api: "fs.readFileSync",
		durationMs: 25,
		file: "src/a.ts",
		line: 42,
		column: 15,
		function: "UsersService.findAll",
		async: { type: "PROMISE", rootType: "SERVER" },
		...overrides,
	};
}

function lagEvent(overrides: Overloads = {}): Record<string, unknown> {
	return {
		type: "loop.lag",
		timestamp: "2026-09-21T10:15:30.200Z",
		pid: 1,
		periodMs: 1000,
		count: 10,
		p50Ms: 0.2,
		p99Ms: 1.5,
		maxMs: 4,
		final: false,
		total: { count: 10, p50Ms: 0.2, p99Ms: 1.5, maxMs: 4 },
		...overrides,
	};
}

function attachEvent(pid: number): Record<string, unknown> {
	return {
		type: "probe.attach",
		timestamp: "2026-09-21T10:15:30.100Z",
		pid,
		ppid: 0,
		nodeVersion: "v22.13.1",
		argv: ["node", "server.js"],
	};
}

function httpEvent(overrides: Overloads = {}): Record<string, unknown> {
	return {
		type: "http.request",
		timestamp: "2026-09-21T10:15:30.300Z",
		pid: 1,
		method: "GET",
		route: "/users/:id",
		status: 200,
		durationMs: 5,
		dbQueries: 0,
		...overrides,
	};
}

function dbEvent(overrides: Overloads = {}): Record<string, unknown> {
	return {
		type: "db.query",
		timestamp: "2026-09-21T10:15:30.300Z",
		pid: 1,
		model: "User",
		action: "findMany",
		durationMs: 1,
		attributed: true,
		...overrides,
	};
}

function memEvent(overrides: Overloads = {}): Record<string, unknown> {
	return {
		type: "mem.sample",
		timestamp: "2026-09-21T10:15:30.300Z",
		pid: 1,
		rssMb: 100,
		heapUsedMb: 50,
		heapTotalMb: 80,
		externalMb: 2,
		...overrides,
	};
}

function gcEvent(overrides: Overloads = {}): Record<string, unknown> {
	return {
		type: "gc.pause",
		timestamp: "2026-09-21T10:15:30.300Z",
		pid: 1,
		kind: "minor",
		durationMs: 1,
		...overrides,
	};
}

test("empty events produce the structural zero state with the no-attach warning", () => {
	const findings = buildFindings({
		sessionId: "s1",
		collectors,
		eventsText: "",
	});
	expect(Object.keys(findings)).toEqual([
		"traceSchemaVersion",
		"sessionId",
		"collectors",
		"loopLag",
		"blocking",
		"http",
		"db",
		"memory",
		"events",
		"warnings",
	]);
	expect(findings.traceSchemaVersion).toBe(1);
	expect(findings.sessionId).toBe("s1");
	expect(findings.collectors).toEqual(collectors);
	expect(findings.loopLag).toEqual({
		windows: 0,
		count: 0,
		p50Ms: 0,
		p99Ms: 0,
		maxMs: 0,
	});
	expect(findings.blocking).toEqual({ count: 0, totalMs: 0, calls: [] });
	expect(Object.keys(findings.http)).toEqual(["requests", "endpoints"]);
	expect(findings.http).toEqual({ requests: 0, endpoints: [] });
	expect(Object.keys(findings.db)).toEqual([
		"queries",
		"totalMs",
		"unattributed",
		"models",
	]);
	expect(findings.db).toEqual({
		queries: 0,
		totalMs: 0,
		unattributed: 0,
		models: [],
	});
	expect(Object.keys(findings.memory)).toEqual([
		"samples",
		"peakRssMb",
		"peakHeapUsedMb",
		"gc",
	]);
	expect(Object.keys(findings.memory.gc)).toEqual([
		"count",
		"totalPauseMs",
		"maxPauseMs",
	]);
	expect(findings.memory).toEqual({
		samples: 0,
		peakRssMb: 0,
		peakHeapUsedMb: 0,
		gc: { count: 0, totalPauseMs: 0, maxPauseMs: 0 },
	});
	expect(findings.events).toEqual({
		lines: 0,
		malformedLines: 0,
		attachProcesses: 0,
	});
	expect(findings.warnings).toEqual([
		"no probe events recorded — the target may not be Node or the hook did not load",
	]);
});

test("block.call events aggregate per site with deterministic ordering", () => {
	const siteA = {
		api: "fs.readFileSync",
		file: "src/a.ts",
		line: 42,
		column: 15,
		function: "UsersService.findAll",
	};
	const text = eventsText(
		attachEvent(1),
		blockEvent({ ...siteA, durationMs: 100 }),
		blockEvent({ ...siteA, durationMs: 50 }),
		blockEvent({ ...siteA, durationMs: 60.25 }),
		blockEvent({
			api: "crypto.pbkdf2Sync",
			file: "src/b.ts",
			line: 7,
			column: 3,
			function: "hashPassword",
			durationMs: 300,
			async: { type: "TIMER", rootType: "TIMER" },
		}),
		blockEvent({
			api: "fs.readFileSync",
			file: "src/a.ts",
			line: 7,
			column: 1,
			function: null,
			durationMs: 210,
		}),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});

	expect(findings.blocking.count).toBe(5);
	expect(findings.blocking.totalMs).toBeCloseTo(720.25, 3);
	expect(findings.blocking.calls).toHaveLength(3);
	expect(
		findings.blocking.calls.map((call) => call.totalMs),
		"sorted by totalMs desc",
	).toEqual([300, 210.25, 210]);
	expect(findings.blocking.calls[0]).toMatchObject({
		api: "crypto.pbkdf2Sync",
		count: 1,
		totalMs: 300,
		maxMs: 300,
		file: "src/b.ts",
		line: 7,
		column: 3,
		function: "hashPassword",
		asyncRootType: "TIMER",
	});
	// Same totalMs ties break by file asc, then line asc.
	expect(findings.blocking.calls[1]).toMatchObject({
		file: "src/a.ts",
		line: 42,
		count: 3,
		totalMs: 210.25,
		maxMs: 100,
		asyncRootType: "SERVER",
	});
	expect(findings.blocking.calls[2]).toMatchObject({
		file: "src/a.ts",
		line: 7,
		function: null,
		// Inherits the fixture builder's default SERVER tag.
		asyncRootType: "SERVER",
	});
});

test("equal totals and equal files tie-break by line, then stay stable", () => {
	const text = eventsText(
		blockEvent({ file: "src/x.ts", line: 9, durationMs: 50 }),
		blockEvent({ file: "src/x.ts", line: 4, durationMs: 50 }),
		blockEvent({ file: "src/x.ts", line: 6, durationMs: 50 }),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});
	expect(findings.blocking.calls.map((call) => call.line)).toEqual([4, 6, 9]);
});

test("asyncRootType is part of the grouping key", () => {
	const text = eventsText(
		blockEvent({ durationMs: 30 }),
		blockEvent({
			durationMs: 40,
			async: { type: "TIMER", rootType: "TIMER" },
		}),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});
	expect(findings.blocking.count).toBe(2);
	expect(findings.blocking.calls).toHaveLength(2);
	expect(findings.blocking.calls.map((call) => call.asyncRootType)).toEqual([
		"TIMER",
		"SERVER",
	]);
});

test("more than 50 groups cap with a warning and keep the top totals", () => {
	const events: Array<Record<string, unknown>> = [attachEvent(1)];
	for (let i = 0; i < 60; i++) {
		events.push(
			blockEvent({
				file: `src/f${String(i).padStart(2, "0")}.ts`,
				durationMs: i + 1,
			}),
		);
	}
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: eventsText(...events),
	});
	expect(findings.blocking.count).toBe(60);
	expect(findings.blocking.calls).toHaveLength(50);
	expect(findings.blocking.calls[0]?.file).toBe("src/f59.ts");
	expect(findings.blocking.calls[49]?.file).toBe("src/f10.ts");
	expect(findings.warnings).toContain("blocking calls capped at 50 groups");
});

test("malformed lines are counted and the rest is analyzed", () => {
	const text = [
		JSON.stringify(attachEvent(1)),
		"not json at all",
		JSON.stringify(blockEvent({ durationMs: 30 })),
		"[1, 2, 3]",
		JSON.stringify(lagEvent({ final: true })),
		"",
	].join("\n");
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});
	expect(findings.events.lines).toBe(5);
	expect(findings.events.malformedLines).toBe(2);
	expect(findings.events.attachProcesses).toBe(1);
	expect(findings.blocking.count).toBe(1);
});

test("loopLag merges the last total per pid with exact sums and max", () => {
	const text = eventsText(
		attachEvent(1),
		attachEvent(2),
		attachEvent(3),
		lagEvent({
			pid: 1,
			total: { count: 100, p50Ms: 1, p99Ms: 10, maxMs: 50 },
		}),
		lagEvent({
			pid: 1,
			final: true,
			total: { count: 100, p50Ms: 1, p99Ms: 10, maxMs: 50 },
		}),
		lagEvent({
			pid: 2,
			final: true,
			total: { count: 300, p50Ms: 2, p99Ms: 20, maxMs: 90 },
		}),
		lagEvent({
			pid: 3,
			total: { count: 10, p50Ms: 3, p99Ms: 30, maxMs: 30 },
		}),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});
	// Two non-final windows (pid 1's first window and pid 3's only window —
	// pid 3 never reached a final flush).
	expect(findings.loopLag.windows).toBe(2);
	expect(findings.loopLag.count).toBe(410);
	expect(findings.loopLag.maxMs).toBe(90);
	expect(findings.loopLag.p50Ms).toBeCloseTo(1.78, 3);
	expect(findings.loopLag.p99Ms).toBeCloseTo(17.805, 3);
});

test("analysis is byte-identical for identical events", () => {
	const text = eventsText(
		attachEvent(1),
		blockEvent({}),
		lagEvent({ final: true }),
		httpEvent({}),
		dbEvent({}),
		memEvent({}),
		gcEvent({}),
	);
	const first = JSON.stringify(
		buildFindings({ sessionId: "s", collectors, eventsText: text }),
	);
	const second = JSON.stringify(
		buildFindings({ sessionId: "s", collectors, eventsText: text }),
	);
	expect(first).toBe(second);
});

test("http requests aggregate per endpoint with exact nearest-rank percentiles", () => {
	// Sorted durations [30, 30.5, 100]: p50 = ceil(0.5·3) = 2 → 30.5,
	// p99 = ceil(0.99·3) = 3 → 100.
	const text = eventsText(
		attachEvent(1),
		httpEvent({ durationMs: 100, status: 500, dbQueries: 12 }),
		httpEvent({ durationMs: 30, dbQueries: 12 }),
		httpEvent({ durationMs: 30.5, dbQueries: 1 }),
		httpEvent({
			route: "/health",
			status: 201,
			durationMs: 1,
		}),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});

	expect(findings.http.requests).toBe(4);
	expect(findings.http.endpoints).toHaveLength(2);
	const [users, health] = findings.http.endpoints;
	expect(users).toEqual({
		method: "GET",
		route: "/users/:id",
		count: 3,
		p50Ms: 30.5,
		p99Ms: 100,
		maxMs: 100,
		statuses: { 200: 2, 500: 1 },
		dbQueries: { total: 25, max: 12, avg: 8.333 },
	});
	expect(health).toEqual({
		method: "GET",
		route: "/health",
		count: 1,
		p50Ms: 1,
		p99Ms: 1,
		maxMs: 1,
		statuses: { 201: 1 },
		dbQueries: { total: 0, max: 0, avg: 0 },
	});
});

test("endpoints sort by p99 desc with method then route tie-breaks", () => {
	const text = eventsText(
		httpEvent({ method: "POST", route: "/b", durationMs: 10 }),
		httpEvent({ method: "GET", route: "/b", durationMs: 10 }),
		httpEvent({ method: "GET", route: "/a", durationMs: 10 }),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});
	expect(findings.http.endpoints.map((e) => [e.method, e.route])).toEqual([
		["GET", "/a"],
		["GET", "/b"],
		["POST", "/b"],
	]);
});

test("statuses keys render in ascending numeric order", () => {
	const text = eventsText(
		httpEvent({ status: 500 }),
		httpEvent({ status: 200 }),
		httpEvent({ status: 404 }),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});
	expect(Object.keys(findings.http.endpoints[0]?.statuses ?? [])).toEqual([
		"200",
		"404",
		"500",
	]);
});

test("more than 50 endpoints cap with a warning and keep the top p99s", () => {
	const events: Array<Record<string, unknown>> = [attachEvent(1)];
	for (let i = 0; i < 60; i++) {
		events.push(
			httpEvent({
				route: `/r${String(i).padStart(2, "0")}`,
				durationMs: i + 1,
			}),
		);
	}
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: eventsText(...events),
	});
	expect(findings.http.requests).toBe(60);
	expect(findings.http.endpoints).toHaveLength(50);
	expect(findings.http.endpoints[0]?.route).toBe("/r59");
	expect(findings.http.endpoints[49]?.route).toBe("/r10");
	expect(findings.warnings).toContain("http endpoints capped at 50 groups");
});

test("N+1 warnings fire at and above the threshold in endpoint order", () => {
	const n1Collectors: ProbeCollectors = { ...collectors, n1Threshold: 2 };
	const text = eventsText(
		attachEvent(1),
		// p99 order: /hot (30) > /edge (20) > /cold (10)
		httpEvent({ route: "/hot", durationMs: 30, dbQueries: 3 }),
		httpEvent({ route: "/edge", durationMs: 20, dbQueries: 2 }),
		httpEvent({ route: "/cold", durationMs: 10, dbQueries: 1 }),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors: n1Collectors,
		eventsText: text,
	});
	expect(findings.warnings).toEqual([
		"endpoint GET /hot saw up to 3 db queries in one request (possible N+1)",
		"endpoint GET /edge saw up to 2 db queries in one request (possible N+1)",
	]);
});

test("db queries aggregate totals, unattributed and models with stable order", () => {
	const text = eventsText(
		attachEvent(1),
		dbEvent({ durationMs: 1 }),
		dbEvent({ durationMs: 2 }),
		dbEvent({ model: "Post", action: "findMany", durationMs: 3.5 }),
		dbEvent({ model: "Post", action: "findMany", durationMs: 0.5 }),
		dbEvent({
			model: null,
			action: "queryRaw",
			durationMs: 1,
			attributed: false,
		}),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});
	expect(findings.db.queries).toBe(5);
	expect(findings.db.totalMs).toBe(8);
	expect(findings.db.unattributed).toBe(1);
	// count desc, then model asc: Post and User tie at 2, "Post" < "User";
	// the null-model row sorts as "".
	expect(findings.db.models).toEqual([
		{ model: "Post", action: "findMany", count: 2 },
		{ model: "User", action: "findMany", count: 2 },
		{ model: null, action: "queryRaw", count: 1 },
	]);
});

test("more than 50 db model rows cap with a warning", () => {
	const events: Array<Record<string, unknown>> = [attachEvent(1)];
	for (let i = 0; i < 60; i++) {
		events.push(
			dbEvent({
				model: `Model${String(i).padStart(2, "0")}`,
				action: "findMany",
				durationMs: 1,
			}),
		);
	}
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: eventsText(...events),
	});
	expect(findings.db.queries).toBe(60);
	expect(findings.db.models).toHaveLength(50);
	// Every row has count 1, so the tie-break is model asc.
	expect(findings.db.models[0]?.model).toBe("Model00");
	expect(findings.db.models[49]?.model).toBe("Model49");
	expect(findings.warnings).toContain("db models capped at 50 groups");
});

test("memory aggregates peaks across processes and gc pause totals", () => {
	const text = eventsText(
		attachEvent(1),
		attachEvent(2),
		memEvent({ pid: 1, rssMb: 100.5, heapUsedMb: 50 }),
		memEvent({ pid: 2, rssMb: 200.25, heapUsedMb: 75.5 }),
		gcEvent({ durationMs: 1 }),
		gcEvent({ kind: "major", durationMs: 2.5 }),
		gcEvent({ kind: "incremental", durationMs: 0.25 }),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});
	expect(findings.memory).toEqual({
		samples: 2,
		peakRssMb: 200.25,
		peakHeapUsedMb: 75.5,
		gc: { count: 3, totalPauseMs: 3.75, maxPauseMs: 2.5 },
	});
});

test("event types from the future are counted as lines but land in no section", () => {
	const text = eventsText(
		attachEvent(1),
		{ type: "http2.request", pid: 1, timestamp: "x" },
		httpEvent({}),
	);
	const findings = buildFindings({
		sessionId: "s",
		collectors,
		eventsText: text,
	});
	expect(findings.events.lines).toBe(3);
	expect(findings.http.requests).toBe(1);
	expect(findings.warnings).toEqual([]);
});
