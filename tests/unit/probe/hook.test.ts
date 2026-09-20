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
