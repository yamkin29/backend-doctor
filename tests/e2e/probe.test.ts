import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { makeTmpDir, runCliAsync } from "./helpers.js";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const fixturesDir = path.join(repoRoot, "tests/fixtures/probe");

function fixture(name: string): string {
	return path.join(fixturesDir, name);
}

/** tmpdir cwd in the realpath form the probe process itself reports. */
function tmpCwd(): string {
	return fs.realpathSync(makeTmpDir());
}

interface SessionDocJson {
	traceSchemaVersion: number;
	session: {
		id: string;
		startedAt: string;
		endedAt: string;
		command: string[];
		cwd: string;
		node: { version: string };
		pid: number;
		duration: { requestedSeconds: number | null; effectiveMs: number };
		filters: string[];
		exit: Record<string, unknown>;
	};
}

function readSessionJson(sessionDir: string): SessionDocJson {
	return JSON.parse(
		fs.readFileSync(path.join(sessionDir, "session.json"), "utf8"),
	);
}

function readEvents(sessionDir: string): Array<Record<string, unknown>> {
	return fs
		.readFileSync(path.join(sessionDir, "events.ndjson"), "utf8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line));
}

function probeStorageRoot(cwd: string, out?: string): string {
	return out ?? path.join(cwd, ".backend-doctor", "probe");
}

function soleSessionDir(cwd: string, out?: string): string {
	const root = probeStorageRoot(cwd, out);
	const entries = fs.readdirSync(root);
	expect(entries, "exactly one session directory").toHaveLength(1);
	return path.join(root, entries[0] as string);
}

function assertCommonSession(
	sessionDir: string,
	cwd: string,
	command: string[],
): void {
	const doc = readSessionJson(sessionDir);
	expect(Object.keys(doc)).toEqual(["traceSchemaVersion", "session"]);
	expect(doc.traceSchemaVersion).toBe(1);
	const session = doc.session;
	expect(Object.keys(session).sort()).toEqual(
		[
			"id",
			"startedAt",
			"endedAt",
			"command",
			"cwd",
			"node",
			"pid",
			"duration",
			"filters",
			"exit",
		].sort(),
	);
	expect(session.id).toBe(path.basename(sessionDir));
	expect(session.command).toEqual(command);
	// The probe records its process cwd, which on macOS is the realpath form
	// (/private/var vs /var — the spec 015 tmpdir lesson).
	expect(session.cwd).toBe(fs.realpathSync(cwd));
	expect(session.pid).toBeGreaterThan(0);
	expect(session.duration.requestedSeconds).toBeNull();
	expect(session.filters).toEqual([]);
	expect(Number.isNaN(Date.parse(session.startedAt))).toBe(false);
	expect(Number.isNaN(Date.parse(session.endedAt))).toBe(false);
	expect(session.node.version).toBe(process.version);
}

test(
	"probe runs the app instrumented: passthrough, warning, session files, exit 0",
	async () => {
		const cwd = tmpCwd();
		const okPath = fixture("ok.js");
		const result = await runCliAsync(["probe", "--", "node", okPath], { cwd });

		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toBe("probe-ok-output\n");

		const sessionDir = soleSessionDir(cwd);
		assertCommonSession(sessionDir, cwd, ["node", okPath]);
		const doc = readSessionJson(sessionDir);
		expect(doc.session.exit).toEqual({ code: 0 });
		expect(doc.session.duration.effectiveMs).toBeGreaterThanOrEqual(0);

		const events = readEvents(sessionDir);
		// Spec 019: the parent-set collectors add a final loop.lag flush, so
		// the stream is bracketed by attach/detach rather than exactly 2 lines.
		expect(events.length).toBeGreaterThanOrEqual(3);
		expect(events[0]?.type).toBe("probe.attach");
		expect(events[events.length - 1]?.type).toBe("probe.detach");
		const lags = events.filter((event) => event.type === "loop.lag");
		expect(lags).toHaveLength(1);
		expect(lags[0]?.final).toBe(true);
		expect(events[0]?.pid).toBe(doc.session.pid);
	},
	{ timeout: 30000 },
);

test("probe stderr carries the sensitivity warning and the trace summary", async () => {
	const cwd = tmpCwd();
	const result = await runCliAsync(["probe", "--", "node", fixture("ok.js")], {
		cwd,
	});
	expect(result.exitCode, result.stderr).toBe(0);

	const sessionDir = soleSessionDir(cwd);
	expect(result.stderr).toContain("backend-doctor probe");
	expect(result.stderr).toContain("may include URLs, file paths");
	expect(result.stderr).toContain(sessionDir);
	expect(result.stderr).toContain("never sent anywhere");
	expect(result.stderr).toContain("Consider gitignoring .backend-doctor/");
	expect(result.stderr).toContain(`trace written to ${sessionDir}`);
	expect(result.stdout).toBe("probe-ok-output\n");
});

test("probe passes the child exit code through and records it", async () => {
	const cwd = tmpCwd();
	const failPath = fixture("fail.js");
	const result = await runCliAsync(["probe", "--", "node", failPath], { cwd });
	expect(result.exitCode).toBe(3);
	expect(result.stdout).toBe("");

	const doc = readSessionJson(soleSessionDir(cwd));
	expect(doc.session.exit).toEqual({ code: 3 });
	const events = readEvents(soleSessionDir(cwd));
	const detach = events[events.length - 1];
	expect(detach?.type).toBe("probe.detach");
	expect(detach?.code).toBe(3);
});

test("two probe runs create distinct session directories", async () => {
	const cwd = tmpCwd();
	expect(
		(await runCliAsync(["probe", "--", "node", fixture("ok.js")], { cwd }))
			.exitCode,
	).toBe(0);
	expect(
		(await runCliAsync(["probe", "--", "node", fixture("ok.js")], { cwd }))
			.exitCode,
	).toBe(0);
	const root = probeStorageRoot(cwd);
	const entries = fs.readdirSync(root);
	expect(entries).toHaveLength(2);
	expect(entries[0]).not.toBe(entries[1]);
});

test("--out relocates the session directory", async () => {
	const cwd = tmpCwd();
	const outRoot = path.join(cwd, "custom-traces");
	const result = await runCliAsync(
		["probe", "--out", outRoot, "--", "node", fixture("ok.js")],
		{ cwd },
	);
	expect(result.exitCode, result.stderr).toBe(0);
	const sessionDir = soleSessionDir(cwd, outRoot);
	expect(path.dirname(sessionDir)).toBe(outRoot);
	assertCommonSession(sessionDir, cwd, ["node", fixture("ok.js")]);
});

test("preexisting NODE_OPTIONS is preserved alongside the probe preload", async () => {
	const cwd = tmpCwd();
	const result = await runCliAsync(
		["probe", "--", "node", fixture("envcheck.js")],
		{
			cwd,
			env: {
				NODE_OPTIONS: `--require ${fixture("dummy-preload.cjs")}`,
			},
		},
	);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(result.stdout).toBe("merge-ok\n");
});

test("probe writes nothing of its own to stdout on usage errors", async () => {
	const cwd = tmpCwd();
	const result = await runCliAsync(["probe"], { cwd });
	expect(result.exitCode).toBe(2);
	expect(result.stdout).toBe("");
	expect(result.stderr).toContain("command");
	expect(fs.existsSync(probeStorageRoot(cwd))).toBe(false);
});

test(
	"--duration bounds the session and escalates shutdown",
	async () => {
		const cwd = tmpCwd();
		const started = Date.now();
		const result = await runCliAsync(
			["probe", "--duration", "1", "--", "node", fixture("long.js")],
			{ cwd },
		);
		const elapsedMs = Date.now() - started;

		expect(result.exitCode, result.stderr).toBe(130);
		expect(elapsedMs).toBeGreaterThanOrEqual(1000);
		expect(elapsedMs).toBeLessThan(15000);

		const doc = readSessionJson(soleSessionDir(cwd));
		expect(doc.session.duration.requestedSeconds).toBe(1);
		expect(doc.session.exit).toEqual({ signal: "SIGINT" });
		// A signal-killed child has no detach line (design decision 5); the
		// authoritative record is session.json's exit field.
		const events = readEvents(soleSessionDir(cwd));
		expect(events[0]?.type).toBe("probe.attach");
	},
	{ timeout: 30000 },
);

test(
	"SIGINT to the probe is forwarded, the session finalized, exit 130",
	async () => {
		const cwd = tmpCwd();
		const binPath = path.join(repoRoot, "dist/bin/backend-doctor.js");
		const child = spawn(
			process.execPath,
			[binPath, "probe", "--duration", "30", "--", "node", fixture("long.js")],
			{ cwd, stdio: ["ignore", "pipe", "pipe"] },
		);
		expect(child.pid).toBeGreaterThan(0);

		// Wait until the hook is attached in the target before signaling.
		const sessionRoot = path.join(cwd, ".backend-doctor", "probe");
		await vi.waitUntil(
			() => {
				const dirs = fs.existsSync(sessionRoot)
					? fs.readdirSync(sessionRoot)
					: [];
				if (dirs.length !== 1) return false;
				return fs
					.readFileSync(
						path.join(sessionRoot, dirs[0] as string, "events.ndjson"),
						"utf8",
					)
					.includes("probe.attach");
			},
			{ timeout: 15000, interval: 100 },
		);

		process.kill(child.pid as number, "SIGINT");
		const [code, signal] = await once(child, "close");

		expect(signal).toBeNull();
		expect(code).toBe(130);
		const doc = readSessionJson(soleSessionDir(cwd));
		expect(doc.session.exit).toEqual({ signal: "SIGINT" });
		expect(doc.session.duration.requestedSeconds).toBe(30);
	},
	{ timeout: 30000 },
);

async function assertUsageError(
	args: string[],
	cwd: string,
	stderrFragment: string,
): Promise<void> {
	const result = await runCliAsync(args, { cwd });
	expect(result.exitCode, result.stderr).toBe(2);
	expect(result.stdout).toBe("");
	expect(result.stderr).toContain(stderrFragment);
	expect(fs.existsSync(probeStorageRoot(cwd))).toBe(false);
}

test(
	"usage and environment errors: exit 2, stderr reason, empty stdout, no session",
	async () => {
		const okPath = fixture("ok.js");

		await assertUsageError(["probe"], tmpCwd(), "command");
		await assertUsageError(["probe", "--"], tmpCwd(), "command");
		await assertUsageError(
			["probe", "--duration", "abc", "--", "node", okPath],
			tmpCwd(),
			"--duration",
		);
		await assertUsageError(
			["probe", "--duration", "0", "--", "node", okPath],
			tmpCwd(),
			"--duration",
		);

		const cwd = tmpCwd();
		const filePath = path.join(cwd, "not-a-dir");
		fs.writeFileSync(filePath, "x");
		await assertUsageError(
			["probe", "--out", filePath, "--", "node", okPath],
			cwd,
			"must be a directory",
		);
	},
	{ timeout: 30000 },
);

test(
	"missing hook preload: exit 2 and no session directory",
	async () => {
		const cwd = tmpCwd();
		const hookPath = path.join(repoRoot, "dist/probe/register.cjs");
		const hiddenPath = `${hookPath}.hidden`;
		fs.renameSync(hookPath, hiddenPath);
		try {
			await assertUsageError(
				["probe", "--", "node", fixture("ok.js")],
				cwd,
				"probe hook not found",
			);
		} finally {
			fs.renameSync(hiddenPath, hookPath);
		}
	},
	{ timeout: 30000 },
);

test(
	"descendant node processes attach with their own pid (NODE_OPTIONS inheritance)",
	async () => {
		const cwd = tmpCwd();
		const result = await runCliAsync(
			["probe", "--", "node", fixture("descendant.js")],
			{ cwd },
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toContain("descendant-parent-output");

		const events = readEvents(soleSessionDir(cwd));
		const attaches = events.filter((event) => event.type === "probe.attach");
		const detaches = events.filter((event) => event.type === "probe.detach");
		expect(attaches.length).toBe(2);
		expect(detaches.length).toBe(2);
		const pids = new Set(attaches.map((event) => event.pid));
		expect(pids.size).toBe(2);
		for (const pid of pids) {
			expect(
				detaches.some((event) => event.pid === pid),
				`detach recorded for pid ${String(pid)}`,
			).toBe(true);
		}
	},
	{ timeout: 30000 },
);

interface FindingsJson {
	traceSchemaVersion: number;
	sessionId: string;
	collectors: {
		blockThresholdMs: number;
		lagIntervalMs: number;
		n1Threshold: number;
	};
	loopLag: {
		windows: number;
		count: number;
		p50Ms: number;
		p99Ms: number;
		maxMs: number;
	};
	blocking: {
		count: number;
		totalMs: number;
		calls: Array<{
			api: string;
			count: number;
			totalMs: number;
			maxMs: number;
			file: string;
			line: number | null;
			column: number | null;
			function: string | null;
			asyncRootType: string;
		}>;
	};
	http: {
		requests: number;
		endpoints: Array<{
			method: string;
			route: string;
			count: number;
			p50Ms: number;
			p99Ms: number;
			maxMs: number;
			statuses: Record<string, number>;
			dbQueries: { total: number; max: number; avg: number };
		}>;
	};
	db: {
		queries: number;
		totalMs: number;
		unattributed: number;
		models: Array<{ model: string | null; action: string; count: number }>;
	};
	memory: {
		samples: number;
		peakRssMb: number;
		peakHeapUsedMb: number;
		gc: { count: number; totalPauseMs: number; maxPauseMs: number };
	};
	events: { lines: number; malformedLines: number; attachProcesses: number };
	warnings: string[];
}

function readFindings(sessionDir: string): FindingsJson {
	return JSON.parse(
		fs.readFileSync(path.join(sessionDir, "findings.json"), "utf8"),
	);
}

test(
	"probe writes findings.json and a stderr summary for a blocking app",
	async () => {
		const cwd = tmpCwd();
		// Run the fixture from the target cwd so the culprit path is recorded
		// relative (the form findings.json is meant to be read in).
		fs.copyFileSync(fixture("blocking.cjs"), path.join(cwd, "blocking.cjs"));
		const result = await runCliAsync(["probe", "--", "node", "blocking.cjs"], {
			cwd,
			env: { BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS: "1" },
		});
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toBe("blocking-done 32\n");

		const sessionDir = soleSessionDir(cwd);
		assertCommonSession(sessionDir, cwd, ["node", "blocking.cjs"]);
		const findings = readFindings(sessionDir);
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
		expect(findings.sessionId).toBe(path.basename(sessionDir));
		expect(findings.collectors).toEqual({
			blockThresholdMs: 1,
			lagIntervalMs: 1000,
			n1Threshold: 20,
		});
		expect(findings.blocking.count).toBeGreaterThanOrEqual(1);
		expect(findings.blocking.calls[0]?.file).toBe("blocking.cjs");
		expect(findings.blocking.calls[0]?.api).toBe("crypto.pbkdf2Sync");
		expect(findings.blocking.calls[0]?.totalMs).toBeGreaterThanOrEqual(1);
		expect(findings.events.attachProcesses).toBe(1);
		expect(findings.warnings).toEqual([]);

		expect(result.stderr).toContain("findings.json");
		expect(result.stderr).toContain("blocking call");
	},
	{ timeout: 30000 },
);

test(
	"probe --filter drives findings at the CLI level",
	async () => {
		const excluded = tmpCwd();
		fs.copyFileSync(
			fixture("blocking.cjs"),
			path.join(excluded, "blocking.cjs"),
		);
		const excludedResult = await runCliAsync(
			["probe", "--filter", "vendor/**", "--", "node", "blocking.cjs"],
			{ cwd: excluded, env: { BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS: "1" } },
		);
		expect(excludedResult.exitCode, excludedResult.stderr).toBe(0);
		const excludedFindings = readFindings(soleSessionDir(excluded));
		expect(excludedFindings.blocking.count).toBe(0);
		expect(excludedFindings.blocking.calls).toEqual([]);

		const included = tmpCwd();
		fs.copyFileSync(
			fixture("blocking.cjs"),
			path.join(included, "blocking.cjs"),
		);
		const includedResult = await runCliAsync(
			["probe", "--filter", "**/blocking.cjs", "--", "node", "blocking.cjs"],
			{ cwd: included, env: { BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS: "1" } },
		);
		expect(includedResult.exitCode, includedResult.stderr).toBe(0);
		const includedFindings = readFindings(soleSessionDir(included));
		expect(includedFindings.blocking.count).toBeGreaterThanOrEqual(1);
	},
	{ timeout: 30000 },
);

test(
	"probe finalizes a zero-state findings.json when the target is not Node",
	async () => {
		const cwd = tmpCwd();
		const result = await runCliAsync(
			["probe", "--", "sh", "-c", "echo not-node"],
			{
				cwd,
			},
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toBe("not-node\n");

		const findings = readFindings(soleSessionDir(cwd));
		expect(findings.blocking).toEqual({ count: 0, totalMs: 0, calls: [] });
		expect(findings.loopLag).toEqual({
			windows: 0,
			count: 0,
			p50Ms: 0,
			p99Ms: 0,
			maxMs: 0,
		});
		expect(findings.events.attachProcesses).toBe(0);
		expect(findings.warnings).toContain(
			"no probe events recorded — the target may not be Node or the hook did not load",
		);
		expect(result.stderr).toContain("no probe events recorded");
	},
	{ timeout: 30000 },
);

test(
	"invalid collector knobs are usage errors before spawn",
	async () => {
		const badThreshold = tmpCwd();
		const thresholdResult = await runCliAsync(
			["probe", "--", "node", fixture("ok.js")],
			{
				cwd: badThreshold,
				env: { BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS: "abc" },
			},
		);
		expect(thresholdResult.exitCode).toBe(2);
		expect(thresholdResult.stdout).toBe("");
		expect(thresholdResult.stderr).toContain(
			"BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS",
		);
		expect(fs.existsSync(probeStorageRoot(badThreshold))).toBe(false);

		const badInterval = tmpCwd();
		const intervalResult = await runCliAsync(
			["probe", "--", "node", fixture("ok.js")],
			{ cwd: badInterval, env: { BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS: "10" } },
		);
		expect(intervalResult.exitCode).toBe(2);
		expect(intervalResult.stdout).toBe("");
		expect(intervalResult.stderr).toContain(
			"BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS",
		);
		expect(fs.existsSync(probeStorageRoot(badInterval))).toBe(false);
	},
	{ timeout: 30000 },
);

test(
	"lag windows are recorded in bounded sessions",
	async () => {
		const cwd = tmpCwd();
		const result = await runCliAsync(
			["probe", "--duration", "2", "--", "node", fixture("spin.cjs")],
			{ cwd, env: { BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS: "100" } },
		);
		expect(result.exitCode, result.stderr).toBe(130);

		const findings = readFindings(soleSessionDir(cwd));
		expect(findings.loopLag.windows).toBeGreaterThanOrEqual(2);
		expect(findings.loopLag.count).toBeGreaterThan(0);
	},
	{ timeout: 30000 },
);

test(
	"probe records an http session: endpoints, summary, unchanged session.json",
	async () => {
		const cwd = tmpCwd();
		const result = await runCliAsync(
			["probe", "--", "node", fixture("http-app.cjs")],
			{ cwd },
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toBe("http-app-done\n");

		const sessionDir = soleSessionDir(cwd);
		assertCommonSession(sessionDir, cwd, ["node", fixture("http-app.cjs")]);

		const findings = readFindings(sessionDir);
		expect(findings.http.requests).toBe(4);
		const users = findings.http.endpoints.find(
			(endpoint) => endpoint.route === "/users/:id",
		);
		expect(users, "express-marker route pattern").toBeDefined();
		expect(users?.method).toBe("GET");
		expect(users?.count).toBe(2);
		expect(users?.statuses).toEqual({ 200: 2 });
		expect(users?.dbQueries).toEqual({ total: 0, max: 0, avg: 0 });
		expect(
			findings.http.endpoints.some((endpoint) => endpoint.route === "/abort"),
		).toBe(false);

		// AC-18: the stderr summary names the http request count.
		expect(result.stderr).toContain("findings.json");
		expect(result.stderr).toContain("4 http request(s)");
	},
	{ timeout: 30000 },
);

test(
	"probe records prisma queries per request and warns on N+1 via the knob",
	async () => {
		const cwd = tmpCwd();
		const result = await runCliAsync(
			["probe", "--", "node", fixture("prisma-app.cjs")],
			{
				cwd,
				env: { BACKEND_DOCTOR_PROBE_N1_THRESHOLD: "2" },
			},
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toBe("prisma-app-done\n");

		const findings = readFindings(soleSessionDir(cwd));
		expect(findings.db.queries).toBe(4);
		expect(findings.db.unattributed).toBe(1);
		expect(findings.db.models).toEqual([
			{ model: "User", action: "findMany", count: 3 },
			{ model: null, action: "queryRaw", count: 1 },
		]);

		const bulk = findings.http.endpoints.find(
			(endpoint) => endpoint.route === "/bulk",
		);
		expect(bulk?.dbQueries).toEqual({ total: 3, max: 3, avg: 3 });
		expect(findings.warnings).toContain(
			"endpoint GET /bulk saw up to 3 db queries in one request (possible N+1)",
		);
	},
	{ timeout: 30000 },
);

test(
	"invalid BACKEND_DOCTOR_PROBE_N1_THRESHOLD is a usage error before spawn",
	async () => {
		const cwd = tmpCwd();
		const result = await runCliAsync(
			["probe", "--", "node", fixture("ok.js")],
			{ cwd, env: { BACKEND_DOCTOR_PROBE_N1_THRESHOLD: "abc" } },
		);
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("BACKEND_DOCTOR_PROBE_N1_THRESHOLD");
		expect(fs.existsSync(probeStorageRoot(cwd))).toBe(false);
	},
	{ timeout: 30000 },
);

test(
	"not-Node targets produce structural zero states for the new sections",
	async () => {
		const cwd = tmpCwd();
		const result = await runCliAsync(
			["probe", "--", "sh", "-c", "echo not-node"],
			{ cwd },
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toBe("not-node\n");

		const findings = readFindings(soleSessionDir(cwd));
		expect(findings.http).toEqual({ requests: 0, endpoints: [] });
		expect(findings.db).toEqual({
			queries: 0,
			totalMs: 0,
			unattributed: 0,
			models: [],
		});
		expect(findings.memory).toEqual({
			samples: 0,
			peakRssMb: 0,
			peakHeapUsedMb: 0,
			gc: { count: 0, totalPauseMs: 0, maxPauseMs: 0 },
		});
		expect(findings.warnings).toContain(
			"no probe events recorded — the target may not be Node or the hook did not load",
		);
	},
	{ timeout: 30000 },
);
