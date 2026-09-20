import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
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
