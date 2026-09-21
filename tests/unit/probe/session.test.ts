import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { hookPreflightError } from "../../../src/probe/runner.js";
import {
	buildSessionDoc,
	createSessionDir,
	utcStamp,
	writeSessionDoc,
} from "../../../src/probe/session.js";
import { TRACE_SCHEMA_VERSION } from "../../../src/probe/types.js";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "bd-session-"));
}

// Spec 018 AC-10 (missing hook preload), unit level since the spec 021
// deviation: the former e2e hid the shared dist artifact, racing every
// parallel worker that spawns the hook.
test("hook preflight accepts an existing hook file", () => {
	const dir = makeTmpDir();
	const hookPath = path.join(dir, "register.cjs");
	fs.writeFileSync(hookPath, "module.exports = {};");
	expect(hookPreflightError(hookPath)).toBeNull();
});

test("hook preflight rejects a missing hook file with the usage reason", () => {
	const hookPath = path.join(makeTmpDir(), "register.cjs");
	expect(hookPreflightError(hookPath)).toBe(
		`probe hook not found in this installation: ${hookPath}`,
	);
});

test("utcStamp is UTC compact form", () => {
	expect(utcStamp(new Date("2026-09-21T10:15:30.123Z"))).toBe(
		"20260921T101530Z",
	);
});

test("session dir defaults to .backend-doctor/probe under cwd", () => {
	const cwd = makeTmpDir();
	const result = createSessionDir(null, cwd);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	const relative = path.relative(cwd, result.session.dir);
	expect(relative.split(path.sep).slice(0, 2).join("/")).toBe(
		".backend-doctor/probe",
	);
});

test("session dir is created inside the given root and is unique per call", () => {
	const root = makeTmpDir();
	const first = createSessionDir(root, makeTmpDir());
	const second = createSessionDir(root, makeTmpDir());
	expect(first.ok && second.ok).toBe(true);
	if (!first.ok || !second.ok) return;
	expect(path.dirname(first.session.dir)).toBe(root);
	expect(path.dirname(second.session.dir)).toBe(root);
	expect(first.session.id).not.toBe(second.session.id);
	expect(first.session.id).toMatch(/^\d{8}T\d{6}Z-\S+$/);
});

test("session dir creation prepares an empty events.ndjson", () => {
	const result = createSessionDir(null, makeTmpDir());
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(fs.existsSync(result.session.eventsPath)).toBe(true);
	expect(fs.readFileSync(result.session.eventsPath, "utf8")).toBe("");
});

test("an existing non-directory storage root is rejected", () => {
	const cwd = makeTmpDir();
	const filePath = path.join(cwd, "not-a-dir");
	fs.writeFileSync(filePath, "x");
	const result = createSessionDir(filePath, cwd);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.error).toContain(filePath);
});

test("session document pins the trace contract shape", () => {
	const doc = buildSessionDoc({
		id: "20260921T101530Z-ab12cd",
		command: ["node", "server.js"],
		cwd: "/repo/apps/api",
		pid: 1234,
		startedAtMs: Date.parse("2026-09-21T10:15:30.123Z"),
		endedAtMs: Date.parse("2026-09-21T10:15:31.456Z"),
		durationSeconds: 60,
		filters: ["**/src/**"],
		exit: { code: 0 },
	});
	expect(doc.traceSchemaVersion).toBe(TRACE_SCHEMA_VERSION);
	expect(TRACE_SCHEMA_VERSION).toBe(1);
	expect(Object.keys(doc)).toEqual(["traceSchemaVersion", "session"]);
	expect(Object.keys(doc.session).sort()).toEqual(
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
	expect(doc.session.startedAt).toBe("2026-09-21T10:15:30.123Z");
	expect(doc.session.endedAt).toBe("2026-09-21T10:15:31.456Z");
	expect(doc.session.duration).toEqual({
		requestedSeconds: 60,
		effectiveMs: 1333,
	});
	expect(doc.session.node.platform).toBe(process.platform);
	expect(doc.session.node.arch).toBe(process.arch);
	expect(doc.session.exit).toEqual({ code: 0 });
});

test("session document records a signal end and unbounded sessions", () => {
	const doc = buildSessionDoc({
		id: "x",
		command: ["node"],
		cwd: "/",
		pid: 1,
		startedAtMs: 1000,
		endedAtMs: 2500,
		durationSeconds: null,
		filters: [],
		exit: { signal: "SIGINT" },
	});
	expect(doc.session.exit).toEqual({ signal: "SIGINT" });
	expect(doc.session.duration).toEqual({
		requestedSeconds: null,
		effectiveMs: 1500,
	});
});

test("session.json is written tab-indented with a trailing newline", () => {
	const dir = makeTmpDir();
	const doc = buildSessionDoc({
		id: "x",
		command: ["node"],
		cwd: "/",
		pid: 1,
		startedAtMs: 0,
		endedAtMs: 1,
		durationSeconds: null,
		filters: [],
		exit: { code: 0 },
	});
	writeSessionDoc(dir, doc);
	const raw = fs.readFileSync(path.join(dir, "session.json"), "utf8");
	expect(raw.endsWith("\n")).toBe(true);
	expect(raw).toContain('\n\t"session"');
	expect(JSON.parse(raw)).toEqual(doc);
});
