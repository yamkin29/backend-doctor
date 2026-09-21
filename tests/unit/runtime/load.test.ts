import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTraceSession } from "../../../src/runtime/load.js";

const tmpRoots: string[] = [];

afterEach(() => {
	for (const root of tmpRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

/** A fresh temp session directory with both trace files, in v1 shape. */
function seedSession(options?: {
	findings?: string;
	session?: string;
	findingsVersion?: number;
	sessionVersion?: number;
	noFindings?: boolean;
	noSession?: boolean;
	noCwd?: boolean;
}): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bd-load-"));
	tmpRoots.push(dir);
	if (!options?.noFindings) {
		fs.writeFileSync(
			path.join(dir, "findings.json"),
			options?.findings ??
				JSON.stringify({
					traceSchemaVersion: options?.findingsVersion ?? 1,
					sessionId: "s1",
					warnings: [],
				}),
		);
	}
	if (!options?.noSession) {
		const session: Record<string, unknown> = { id: "s1" };
		if (!options?.noCwd) session.cwd = "/probe/cwd";
		fs.writeFileSync(
			path.join(dir, "session.json"),
			options?.session ??
				JSON.stringify({
					traceSchemaVersion: options?.sessionVersion ?? 1,
					session,
				}),
		);
	}
	return dir;
}

describe("loadTraceSession — happy path (AC-1)", () => {
	it("returns the parsed findings, session cwd, and provenance", () => {
		const dir = seedSession();
		const loaded = loadTraceSession(dir);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.trace.findings).toEqual({
			traceSchemaVersion: 1,
			sessionId: "s1",
			warnings: [],
		});
		expect(loaded.trace.findingsPath).toBe(path.join(dir, "findings.json"));
		expect(loaded.trace.sessionCwd).toBe("/probe/cwd");
		expect(loaded.trace.provenance).toEqual({
			sessionDir: dir,
			traceSchemaVersion: 1,
		});
	});
});

describe("loadTraceSession — red paths (AC-2)", () => {
	it("rejects a missing directory", () => {
		const missing = path.join(os.tmpdir(), "bd-load-missing-dir");
		const loaded = loadTraceSession(missing);
		expect(loaded).toEqual({
			ok: false,
			error: `trace directory does not exist: ${missing}`,
		});
	});

	it("rejects a path that is not a directory", () => {
		const file = seedSession();
		const target = path.join(file, "findings.json");
		const loaded = loadTraceSession(target);
		expect(loaded).toEqual({
			ok: false,
			error: `trace path is not a directory: ${target}`,
		});
	});

	it("rejects a session directory without findings.json", () => {
		const dir = seedSession({ noFindings: true });
		const loaded = loadTraceSession(dir);
		expect(loaded).toEqual({
			ok: false,
			error: `trace findings.json not found: ${path.join(dir, "findings.json")}`,
		});
	});

	it("rejects unparseable findings.json", () => {
		const dir = seedSession({ findings: "{not json" });
		const loaded = loadTraceSession(dir);
		expect(loaded).toEqual({
			ok: false,
			error: `trace findings.json is not valid JSON: ${path.join(dir, "findings.json")}`,
		});
	});

	it("rejects an unsupported findings traceSchemaVersion", () => {
		const dir = seedSession({ findingsVersion: 2 });
		const loaded = loadTraceSession(dir);
		expect(loaded).toEqual({
			ok: false,
			error: `unsupported findings.json traceSchemaVersion 2 (expected 1): ${path.join(dir, "findings.json")}`,
		});
	});

	it("rejects a session directory without session.json", () => {
		const dir = seedSession({ noSession: true });
		const loaded = loadTraceSession(dir);
		expect(loaded).toEqual({
			ok: false,
			error: `trace session.json not found: ${path.join(dir, "session.json")}`,
		});
	});

	it("rejects unparseable session.json", () => {
		const dir = seedSession({ session: "]" });
		const loaded = loadTraceSession(dir);
		expect(loaded).toEqual({
			ok: false,
			error: `trace session.json is not valid JSON: ${path.join(dir, "session.json")}`,
		});
	});

	it("rejects an unsupported session traceSchemaVersion", () => {
		const dir = seedSession({ sessionVersion: 3 });
		const loaded = loadTraceSession(dir);
		expect(loaded).toEqual({
			ok: false,
			error: `unsupported session.json traceSchemaVersion 3 (expected 1): ${path.join(dir, "session.json")}`,
		});
	});

	it("rejects a session.json without a session.cwd string", () => {
		const dir = seedSession({ noCwd: true });
		const loaded = loadTraceSession(dir);
		expect(loaded).toEqual({
			ok: false,
			error: `trace session.json has no "session.cwd" string: ${path.join(dir, "session.json")}`,
		});
	});
});
