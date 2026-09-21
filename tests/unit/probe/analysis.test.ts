import { expect, test } from "vitest";
import { buildFindings } from "../../../src/probe/analysis.js";
import type { ProbeCollectors } from "../../../src/probe/options.js";

const collectors: ProbeCollectors = {
	blockThresholdMs: 20,
	lagIntervalMs: 1000,
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
	);
	const first = JSON.stringify(
		buildFindings({ sessionId: "s", collectors, eventsText: text }),
	);
	const second = JSON.stringify(
		buildFindings({ sessionId: "s", collectors, eventsText: text }),
	);
	expect(first).toBe(second);
});
