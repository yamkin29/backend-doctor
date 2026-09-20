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
		expect(events).toHaveLength(2);
		expect(events[0]?.type).toBe("probe.attach");
		expect(events[1]?.type).toBe("probe.detach");
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
	expect(events[1]?.code).toBe(3);
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
