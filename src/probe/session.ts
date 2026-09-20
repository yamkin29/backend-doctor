import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
	type ProbeExit,
	type ProbeSession,
	TRACE_SCHEMA_VERSION,
	type TraceDocument,
} from "./types.js";

/** Compact UTC stamp used as the session-id prefix, e.g. 20260921T101530Z. */
export function utcStamp(date: Date = new Date()): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
}

export interface CreatedSession {
	/** Session id == the session directory's basename. */
	id: string;
	/** Absolute session directory path. */
	dir: string;
	/** Absolute events.ndjson path, created empty at session start. */
	eventsPath: string;
}

export type CreateSessionResult =
	| { ok: true; session: CreatedSession }
	| { ok: false; error: string };

/**
 * Creates `<out>/<UTC stamp>-<mkdtemp suffix>/` with an empty events.ndjson.
 * mkdtemp guarantees uniqueness even for same-second sessions (AC-6); an
 * existing non-directory root is a loud usage error, everything else is
 * mkdir -p'd (AC-5).
 */
export function createSessionDir(
	outDir: string | null,
	cwd: string,
): CreateSessionResult {
	const root = outDir ?? path.join(cwd, ".backend-doctor", "probe");
	if (fs.existsSync(root) && !fs.statSync(root).isDirectory()) {
		return { ok: false, error: `--out must be a directory, got file: ${root}` };
	}
	fs.mkdirSync(root, { recursive: true });
	const dir = fs.mkdtempSync(path.join(root, `${utcStamp()}-`));
	const eventsPath = path.join(dir, "events.ndjson");
	fs.writeFileSync(eventsPath, "");
	return { ok: true, session: { id: path.basename(dir), dir, eventsPath } };
}

export interface SessionDocInput {
	id: string;
	command: string[];
	cwd: string;
	pid: number;
	/** Epoch millis — converted to ISO inside, so effectiveMs stays exact. */
	startedAtMs: number;
	endedAtMs: number;
	durationSeconds: number | null;
	filters: string[];
	exit: ProbeExit;
}

/** Builds the versioned session.json document (AC-4; key set is pinned). */
export function buildSessionDoc(input: SessionDocInput): TraceDocument {
	const session: ProbeSession = {
		id: input.id,
		startedAt: new Date(input.startedAtMs).toISOString(),
		endedAt: new Date(input.endedAtMs).toISOString(),
		command: input.command,
		cwd: input.cwd,
		node: {
			version: process.version,
			platform: process.platform,
			arch: process.arch,
		},
		pid: input.pid,
		duration: {
			requestedSeconds: input.durationSeconds,
			effectiveMs: input.endedAtMs - input.startedAtMs,
		},
		filters: input.filters,
		exit: input.exit,
	};
	return { traceSchemaVersion: TRACE_SCHEMA_VERSION, session };
}

/** Tab-indented like renderJson — session.json is a file humans read. */
export function writeSessionDoc(dir: string, doc: TraceDocument): void {
	fs.writeFileSync(
		path.join(dir, "session.json"),
		`${JSON.stringify(doc, null, "\t")}\n`,
	);
}
