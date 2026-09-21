import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const hookPath = path.join(repoRoot, "dist/probe/register.cjs");
const fixturesDir = path.join(repoRoot, "tests/fixtures/probe");

function spawnHost(
	script: string,
	env: Record<string, string | undefined>,
): {
	stdout: string;
	stderr: string;
	status: number | null;
	statusMessage: string;
} {
	const res = spawnSync(process.execPath, ["--require", hookPath, script], {
		encoding: "utf8",
		env: { ...process.env, ...env },
		timeout: 15000,
	});
	const statusMessage = `exit ${String(res.status)} stderr=${res.stderr ?? ""} err=${String(res.error)}`;
	return {
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		status: res.status,
		statusMessage,
	};
}

function makeEventsPath(): string {
	return path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), "bd-hook-")),
		"events.ndjson",
	);
}

const COLLECTORS = JSON.stringify({
	blockThresholdMs: 10,
	lagIntervalMs: 1000,
});

function parseEvents(filePath: string): Array<Record<string, unknown>> {
	return fs
		.readFileSync(filePath, "utf8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("hook without session env: notice, no events, host unaffected", () => {
	const res = spawnHost(path.join(fixturesDir, "ok.js"), {
		BACKEND_DOCTOR_PROBE_EVENTS: undefined,
	});
	expect(res.status, res.statusMessage).toBe(0);
	expect(res.stdout).toBe("probe-ok-output\n");
	expect(res.stderr).toContain("backend-doctor probe");
});

test("hook with session env: attach before detach, NDJSON discipline", () => {
	const eventsPath = makeEventsPath();
	const res = spawnHost(path.join(fixturesDir, "ok.js"), {
		BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
	});
	expect(res.status).toBe(0);
	expect(res.stdout).toBe("probe-ok-output\n");
	expect(res.stderr).toBe("");

	const events = parseEvents(eventsPath);
	expect(events).toHaveLength(2);
	const [attach, detach] = events;
	expect(attach?.type).toBe("probe.attach");
	expect(detach?.type).toBe("probe.detach");
	for (const event of events) {
		expect(typeof event.pid).toBe("number");
		expect((event.pid as number) > 0).toBe(true);
		expect(typeof event.timestamp).toBe("string");
		expect(Number.isNaN(Date.parse(event.timestamp as string))).toBe(false);
	}
	expect(attach?.pid).toBe(detach?.pid);
	expect((attach?.timestamp as string) <= (detach?.timestamp as string)).toBe(
		true,
	);
	expect(attach?.ppid).toBe(process.pid);
	expect(String(attach?.nodeVersion).startsWith("v")).toBe(true);
	expect(Array.isArray(attach?.argv)).toBe(true);
	expect(JSON.stringify(attach?.argv)).toContain("ok.js");
	expect(detach?.reason).toBe("exit");
	expect(detach?.code).toBe(0);
});

test("hook records the host exit code on detach", () => {
	const eventsPath = makeEventsPath();
	const res = spawnHost(path.join(fixturesDir, "fail.js"), {
		BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
	});
	expect(res.status).toBe(3);
	const events = parseEvents(eventsPath);
	expect(events).toHaveLength(2);
	expect(events[1]?.type).toBe("probe.detach");
	expect(events[1]?.code).toBe(3);
});

test("hook guards against a second attach in the same process", () => {
	const eventsPath = makeEventsPath();
	const res = spawnSync(
		process.execPath,
		[
			"--require",
			hookPath,
			"-e",
			`require(${JSON.stringify(hookPath)}); console.log("double-loaded");`,
		],
		{
			encoding: "utf8",
			env: { ...process.env, BACKEND_DOCTOR_PROBE_EVENTS: eventsPath },
			timeout: 15000,
		},
	);
	expect(res.status).toBe(0);
	expect(res.stdout).toContain("double-loaded");
	const events = parseEvents(eventsPath);
	expect(events).toHaveLength(2);
	expect(events[0]?.type).toBe("probe.attach");
	expect(events[1]?.type).toBe("probe.detach");
});

test("hook with an unwritable events path: notice, inert, host unaffected", () => {
	const res = spawnHost(path.join(fixturesDir, "ok.js"), {
		BACKEND_DOCTOR_PROBE_EVENTS: path.join(
			makeEventsPath(),
			"missing-dir",
			"events.ndjson",
		),
	});
	expect(res.status).toBe(0);
	expect(res.stdout).toBe("probe-ok-output\n");
	expect(res.stderr).toContain("backend-doctor probe");
});

test("collectors: attach carries the block, final lag flush precedes detach", () => {
	const eventsPath = makeEventsPath();
	const res = spawnHost(path.join(fixturesDir, "ok.js"), {
		BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
		BACKEND_DOCTOR_PROBE_COLLECTORS: COLLECTORS,
	});
	expect(res.status, res.statusMessage).toBe(0);
	expect(res.stdout).toBe("probe-ok-output\n");

	const events = parseEvents(eventsPath);
	expect(events.length).toBeGreaterThanOrEqual(3);
	const attach = events[0];
	const last = events[events.length - 1];
	expect(attach?.type).toBe("probe.attach");
	expect(attach?.collectors).toEqual({
		blockThresholdMs: 10,
		lagIntervalMs: 1000,
	});
	expect(last?.type).toBe("probe.detach");

	// A short-lived process emits exactly the final flush (the unref'd window
	// timer never fires), with the cumulative total block.
	const lags = events.filter((event) => event.type === "loop.lag");
	expect(lags).toHaveLength(1);
	const lag = lags[0] as Record<string, unknown>;
	expect(lag.final).toBe(true);
	expect(lag.periodMs).toBe(1000);
	expect(typeof lag.count).toBe("number");
	for (const key of ["p50Ms", "p99Ms", "maxMs"] as const) {
		expect(typeof lag[key]).toBe("number");
	}
	const total = lag.total as Record<string, unknown>;
	for (const key of ["count", "p50Ms", "p99Ms", "maxMs"] as const) {
		expect(typeof total[key]).toBe("number");
	}
	// count may legitimately be 0: an immediately-exiting process records no
	// loop turns at all.
	// Ordering guarantee: the final flush sits right before the detach line.
	expect(events.indexOf(lag)).toBe(events.length - 2);
});

test(
	"collectors: periodic non-final windows appear in long sessions",
	() => {
		const eventsPath = makeEventsPath();
		const res = spawnHost(path.join(fixturesDir, "spin.cjs"), {
			BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
			BACKEND_DOCTOR_PROBE_COLLECTORS: JSON.stringify({
				blockThresholdMs: 10,
				lagIntervalMs: 300,
			}),
		});
		expect(res.status, res.statusMessage).toBe(0);
		expect(res.stdout).toContain("spin-done");

		const events = parseEvents(eventsPath);
		const windows = events.filter(
			(event) => event.type === "loop.lag" && event.final === false,
		);
		expect(windows.length).toBeGreaterThanOrEqual(2);
		for (const window of windows) {
			expect(typeof window.periodMs).toBe("number");
			// count may still be 0: monitorEventLoopDelay's sampling granularity
			// does not guarantee a recorded sample per wall-clock window.
			expect(typeof window.count).toBe("number");
			expect(typeof window.p50Ms).toBe("number");
		}
		const finals = events.filter(
			(event) => event.type === "loop.lag" && event.final === true,
		);
		expect(finals).toHaveLength(1);
	},
	{ timeout: 15000 },
);

test("malformed collectors JSON: one notice, lifecycle-only", () => {
	const eventsPath = makeEventsPath();
	const res = spawnHost(path.join(fixturesDir, "ok.js"), {
		BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
		BACKEND_DOCTOR_PROBE_COLLECTORS: "not-json",
	});
	expect(res.status, res.statusMessage).toBe(0);
	expect(res.stderr).toContain("collectors");

	const events = parseEvents(eventsPath);
	expect(events.map((event) => event.type)).toEqual([
		"probe.attach",
		"probe.detach",
	]);
	expect(events[0]?.collectors).toBeUndefined();
});

function makeBigFile(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bd-block-"));
	const target = path.join(dir, "big.bin");
	fs.writeFileSync(target, Buffer.alloc(32 * 1024 * 1024, 1));
	return target;
}

function blockCalls(eventsPath: string): Array<Record<string, unknown>> {
	return parseEvents(eventsPath).filter((event) => event.type === "block.call");
}

test("blocking: slow sync calls are attributed to the fixture", () => {
	const eventsPath = makeEventsPath();
	const target = makeBigFile();
	const res = spawnHost(path.join(fixturesDir, "blocking.cjs"), {
		BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
		// 1ms threshold: even a page-cached big read clears it reliably.
		BACKEND_DOCTOR_PROBE_COLLECTORS: JSON.stringify({
			blockThresholdMs: 1,
			lagIntervalMs: 1000,
		}),
		BLOCK_TARGET: target,
	});
	expect(res.status, res.statusMessage).toBe(0);
	expect(res.stdout).toContain("blocking-done");

	const calls = blockCalls(eventsPath);
	expect(calls.length).toBeGreaterThanOrEqual(2);
	const cryptoCall = calls.find((event) => event.api === "crypto.pbkdf2Sync");
	expect(cryptoCall, "crypto call recorded").toBeDefined();
	expect(cryptoCall?.durationMs as number).toBeGreaterThanOrEqual(10);
	expect(String(cryptoCall?.file)).toMatch(/blocking\.cjs$/);
	expect(typeof cryptoCall?.line).toBe("number");
	expect(typeof cryptoCall?.column).toBe("number");

	const fsCall = calls.find((event) => event.api === "fs.readFileSync");
	expect(fsCall, "fs call recorded").toBeDefined();
	// The configured threshold in this test is 1ms.
	expect(fsCall?.durationMs as number).toBeGreaterThanOrEqual(1);
	expect(String(fsCall?.file)).toMatch(/blocking\.cjs$/);

	for (const call of calls) {
		expect(typeof call.timestamp).toBe("string");
		expect(typeof call.pid).toBe("number");
	}
});

test("blocking: ESM named imports are attributed", () => {
	const eventsPath = makeEventsPath();
	const res = spawnHost(path.join(fixturesDir, "blocking.mjs"), {
		BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
		BACKEND_DOCTOR_PROBE_COLLECTORS: COLLECTORS,
	});
	expect(res.status, res.statusMessage).toBe(0);
	expect(res.stdout).toContain("blocking-done");

	const calls = blockCalls(eventsPath);
	const cryptoCall = calls.find((event) => event.api === "crypto.pbkdf2Sync");
	expect(cryptoCall, "ESM crypto call recorded").toBeDefined();
	expect(cryptoCall?.durationMs as number).toBeGreaterThanOrEqual(10);
	expect(String(cryptoCall?.file)).toMatch(/blocking\.mjs$/);
});

test("blocking: inert hook leaves core functions native", () => {
	// Core functions are mostly JS in lib/, so toString() cannot tell — the
	// wrapper carries a non-enumerable marker property instead.
	const check = `console.log(require("node:fs").readFileSync.__backendDoctorProbeWrapped === true ? "patched" : "native");`;

	const inert = spawnSync(
		process.execPath,
		["--require", hookPath, "-e", check],
		{
			encoding: "utf8",
			env: { ...process.env, BACKEND_DOCTOR_PROBE_EVENTS: undefined },
			timeout: 15000,
		},
	);
	expect(inert.stdout?.trim()).toBe("native");

	const active = spawnSync(
		process.execPath,
		["--require", hookPath, "-e", check],
		{
			encoding: "utf8",
			env: {
				...process.env,
				BACKEND_DOCTOR_PROBE_EVENTS: makeEventsPath(),
				BACKEND_DOCTOR_PROBE_COLLECTORS: COLLECTORS,
			},
			timeout: 15000,
		},
	);
	expect(active.stdout?.trim()).toBe("patched");
});

test("blocking: never attributes the hook bundle or node internals", () => {
	const eventsPath = makeEventsPath();
	const res = spawnHost(path.join(fixturesDir, "blocking.cjs"), {
		BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
		BACKEND_DOCTOR_PROBE_COLLECTORS: COLLECTORS,
	});
	expect(res.status, res.statusMessage).toBe(0);

	for (const call of blockCalls(eventsPath)) {
		expect(String(call.file)).not.toContain("register.cjs");
		expect(String(call.file)).not.toMatch(/^node:/);
		expect(
			call.function === null ||
				call.function === "" ||
				typeof call.function === "string",
		).toBe(true);
	}
});

test("filters: non-matching block.call suppressed, lag and lifecycle kept", () => {
	const eventsPath = makeEventsPath();
	const target = makeBigFile();
	const res = spawnHost(path.join(fixturesDir, "blocking.cjs"), {
		BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
		BACKEND_DOCTOR_PROBE_COLLECTORS: JSON.stringify({
			blockThresholdMs: 1,
			lagIntervalMs: 1000,
		}),
		BACKEND_DOCTOR_PROBE_FILTERS: JSON.stringify(["vendor/**"]),
		BLOCK_TARGET: target,
	});
	expect(res.status, res.statusMessage).toBe(0);
	expect(blockCalls(eventsPath)).toHaveLength(0);

	const types = parseEvents(eventsPath).map((event) => event.type);
	expect(types).toContain("probe.attach");
	expect(types).toContain("loop.lag");
	expect(types).toContain("probe.detach");
});

test("filters: a matching glob records the block.call", () => {
	const eventsPath = makeEventsPath();
	const res = spawnHost(path.join(fixturesDir, "blocking.cjs"), {
		BACKEND_DOCTOR_PROBE_EVENTS: eventsPath,
		BACKEND_DOCTOR_PROBE_COLLECTORS: COLLECTORS,
		BACKEND_DOCTOR_PROBE_FILTERS: JSON.stringify(["**/blocking.cjs"]),
	});
	expect(res.status, res.statusMessage).toBe(0);
	expect(blockCalls(eventsPath).length).toBeGreaterThanOrEqual(1);
});
