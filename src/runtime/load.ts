/**
 * Loading a probe session directory for the combined report (spec 021).
 * This is the feature's only I/O: validate the directory, parse both trace
 * files, branch on their traceSchemaVersion (consumers never guess), and
 * hand the merge a loaded trace. Every red path returns a loud reason —
 * the scan turns it into exit 2, never a silent static-only report
 * (constitution §8).
 */
import fs from "node:fs";
import path from "node:path";
import type { RuntimeProvenance } from "../core/types.js";
import type { FindingsDocument, TRACE_SCHEMA_VERSION } from "../probe/types.js";

export interface LoadedTrace {
	findings: FindingsDocument;
	/** Absolute path of the parsed findings.json. */
	findingsPath: string;
	/** The probe process cwd from session.json — base for relative culprit paths. */
	sessionCwd: string;
	provenance: RuntimeProvenance;
}

export type LoadTraceResult =
	| { ok: true; trace: LoadedTrace }
	| { ok: false; error: string };

interface TraceJson {
	traceSchemaVersion?: unknown;
	session?: { cwd?: unknown };
}

function isOne(value: unknown): value is typeof TRACE_SCHEMA_VERSION {
	return value === 1;
}

/**
 * Loads the session directory at `dir` (absolute). Validation per spec 021
 * AC-2: a directory; findings.json and session.json present, parseable, and
 * carrying traceSchemaVersion 1; session.cwd a string (design decision 2 —
 * wrong blocking-call positioning is a lie, so a session without a cwd is
 * not a mergeable trace). The findings document's sections are NOT validated
 * here: the merge degrades missing sections to zero diagnostics.
 */
export function loadTraceSession(dir: string): LoadTraceResult {
	if (!fs.existsSync(dir)) {
		return { ok: false, error: `trace directory does not exist: ${dir}` };
	}
	if (!fs.statSync(dir).isDirectory()) {
		return { ok: false, error: `trace path is not a directory: ${dir}` };
	}

	const findingsPath = path.join(dir, "findings.json");
	if (!fs.existsSync(findingsPath)) {
		return {
			ok: false,
			error: `trace findings.json not found: ${findingsPath}`,
		};
	}
	const sessionPath = path.join(dir, "session.json");
	if (!fs.existsSync(sessionPath)) {
		return { ok: false, error: `trace session.json not found: ${sessionPath}` };
	}

	let findingsJson: TraceJson;
	try {
		findingsJson = JSON.parse(
			fs.readFileSync(findingsPath, "utf8"),
		) as TraceJson;
	} catch {
		return {
			ok: false,
			error: `trace findings.json is not valid JSON: ${findingsPath}`,
		};
	}
	if (!isOne(findingsJson.traceSchemaVersion)) {
		return {
			ok: false,
			error: `unsupported findings.json traceSchemaVersion ${String(findingsJson.traceSchemaVersion)} (expected 1): ${findingsPath}`,
		};
	}

	let sessionJson: TraceJson;
	try {
		sessionJson = JSON.parse(fs.readFileSync(sessionPath, "utf8")) as TraceJson;
	} catch {
		return {
			ok: false,
			error: `trace session.json is not valid JSON: ${sessionPath}`,
		};
	}
	if (!isOne(sessionJson.traceSchemaVersion)) {
		return {
			ok: false,
			error: `unsupported session.json traceSchemaVersion ${String(sessionJson.traceSchemaVersion)} (expected 1): ${sessionPath}`,
		};
	}
	const cwd = sessionJson.session?.cwd;
	if (typeof cwd !== "string") {
		return {
			ok: false,
			error: `trace session.json has no "session.cwd" string: ${sessionPath}`,
		};
	}

	const provenance: RuntimeProvenance = {
		sessionDir: dir,
		traceSchemaVersion: 1,
	};
	return {
		ok: true,
		trace: {
			findings: findingsJson as FindingsDocument,
			findingsPath,
			sessionCwd: cwd,
			provenance,
		},
	};
}
