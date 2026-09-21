import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildFindings } from "./analysis.js";
import { buildNodeOptions } from "./node-options.js";
import type { ParsedProbeOptions, ProbeCollectors } from "./options.js";
import {
	buildSessionDoc,
	createSessionDir,
	writeSessionDoc,
} from "./session.js";
import type { ProbeExit } from "./types.js";

const NOTICE_PREFIX = "backend-doctor probe:";
const EVENT_ENV = "BACKEND_DOCTOR_PROBE_EVENTS";
const COLLECTORS_ENV = "BACKEND_DOCTOR_PROBE_COLLECTORS";
const FILTERS_ENV = "BACKEND_DOCTOR_PROBE_FILTERS";
const ESCALATION_STEP_MS = 5000;

/**
 * The built preload inside this installation. The runner is bundled into
 * dist/bin/backend-doctor.js, so the hook sits one level up under probe/.
 */
export function probeHookPath(): string {
	return path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../probe/register.cjs",
	);
}

/**
 * Spec 018 AC-10 preflight: the usage-error reason when the installation's
 * hook preload is missing, or null when the run may start. Extracted from
 * runProbe so the missing-hook red path is testable without hiding the
 * shared dist artifact (which races every parallel worker that spawns the
 * hook — the spec 021 deviation).
 */
export function hookPreflightError(hookPath: string): string | null {
	if (!fs.existsSync(hookPath)) {
		return `probe hook not found in this installation: ${hookPath}`;
	}
	return null;
}

function warningText(sessionDir: string): string {
	return (
		`backend-doctor probe: this session records runtime data that may include URLs, file paths and other request data.\n` +
		`Traces stay on this machine under ${sessionDir} and are never sent anywhere. Consider gitignoring .backend-doctor/.\n`
	);
}

function signalExitCode(signal: string): number {
	const number_ = (os.constants.signals as Record<string, number>)[signal];
	return 128 + (number_ ?? 0);
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Reads the recorded events, derives the versioned findings document (pure,
 * deterministic for a given events file), writes findings.json next to the
 * session files, and prints one stderr summary line. Findings never change
 * the probe's exit code: an analysis failure is loud on stderr only.
 */
function finalizeFindings(
	eventsPath: string,
	sessionDir: string,
	sessionId: string,
	collectors: ProbeCollectors,
): void {
	const findingsPath = path.join(sessionDir, "findings.json");
	try {
		const findings = buildFindings({
			sessionId,
			collectors,
			eventsText: fs.readFileSync(eventsPath, "utf8"),
		});
		fs.writeFileSync(findingsPath, `${JSON.stringify(findings, null, "\t")}\n`);
		for (const warning of findings.warnings) {
			process.stderr.write(`${NOTICE_PREFIX} ${warning}\n`);
		}
		process.stderr.write(
			`${NOTICE_PREFIX} findings written to ${findingsPath} — ` +
				`${findings.blocking.count} blocking call(s) >= ${collectors.blockThresholdMs}ms ` +
				`(total ${round1(findings.blocking.totalMs)}ms), lag p99 ${round1(findings.loopLag.p99Ms)}ms, ` +
				`${findings.http.requests} http request(s)\n`,
		);
	} catch (error) {
		process.stderr.write(
			`${NOTICE_PREFIX} findings finalization failed: ${(error as Error).message}\n`,
		);
	}
}

/**
 * Runs one instrumented session (spec 018): validates the installation, spawns
 * the start command with the preload injected via NODE_OPTIONS, records how the
 * child ended, and finalizes the session directory on every path. Usage and
 * environment failures are loud, exit 2, and leave no session directory behind.
 */
export function runProbe(input: {
	parsed: ParsedProbeOptions;
	cwd: string;
}): Promise<number> {
	const { parsed, cwd } = input;
	const command = parsed.command[0];
	if (command === undefined) {
		process.stderr.write("no start command given\n");
		return Promise.resolve(2);
	}
	const args = parsed.command.slice(1);

	const hookPath = probeHookPath();
	const hookError = hookPreflightError(hookPath);
	if (hookError !== null) {
		process.stderr.write(`${hookError}\n`);
		return Promise.resolve(2);
	}

	const created = createSessionDir(parsed.outDir, cwd);
	if (!created.ok) {
		process.stderr.write(`${created.error}\n`);
		return Promise.resolve(2);
	}
	const { session } = created;

	// Sensitivity warning before the child starts (AC-3, constitution §9).
	process.stderr.write(warningText(session.dir));

	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) env[key] = value;
	}
	env.NODE_OPTIONS = buildNodeOptions(process.env.NODE_OPTIONS, hookPath);
	env[EVENT_ENV] = session.eventsPath;
	// Collector settings (spec 019): validated knobs, re-exported in the
	// normalized shape the hook expects — the child never parses raw knobs.
	env[COLLECTORS_ENV] = JSON.stringify(parsed.collectors);
	if (parsed.filters.length > 0) {
		env[FILTERS_ENV] = JSON.stringify(parsed.filters);
	}

	const startedAtMs = Date.now();
	const child = spawn(command, args, {
		cwd,
		env,
		stdio: ["inherit", "inherit", "inherit"],
		shell: false,
	});

	let probeSignal: NodeJS.Signals | undefined;
	const escalationTimers: NodeJS.Timeout[] = [];
	const forward = (signal: NodeJS.Signals): void => {
		probeSignal = signal;
		child.kill(signal);
	};
	process.on("SIGINT", forward);
	process.on("SIGTERM", forward);

	if (parsed.durationSeconds !== null) {
		// Graceful escalation at expiry (AC-7): SIGINT when the window ends,
		// then SIGTERM/SIGKILL at fixed grace steps if the child ignores the
		// previous signal. Timers are cleared on child exit; child.kill on an
		// already-dead child is a no-op.
		const expiryMs = parsed.durationSeconds * 1000;
		escalationTimers.push(setTimeout(() => child.kill("SIGINT"), expiryMs));
		escalationTimers.push(
			setTimeout(() => child.kill("SIGTERM"), expiryMs + ESCALATION_STEP_MS),
		);
		escalationTimers.push(
			setTimeout(
				() => child.kill("SIGKILL"),
				expiryMs + 2 * ESCALATION_STEP_MS,
			),
		);
	}

	return new Promise<number>((resolve) => {
		child.on("error", (error: Error) => {
			for (const timer of escalationTimers) clearTimeout(timer);
			process.off("SIGINT", forward);
			process.off("SIGTERM", forward);
			fs.rmSync(session.dir, { recursive: true, force: true });
			process.stderr.write(`cannot start ${command}: ${error.message}\n`);
			resolve(2);
		});
		child.on("exit", (code, signal) => {
			for (const timer of escalationTimers) clearTimeout(timer);
			process.off("SIGINT", forward);
			process.off("SIGTERM", forward);

			const exit: ProbeExit =
				signal !== null ? { signal } : { code: code ?? 0 };
			const doc = buildSessionDoc({
				id: session.id,
				command: parsed.command,
				cwd,
				pid: child.pid ?? 0,
				startedAtMs,
				endedAtMs: Date.now(),
				durationSeconds: parsed.durationSeconds,
				filters: parsed.filters,
				exit,
			});
			writeSessionDoc(session.dir, doc);
			finalizeFindings(
				session.eventsPath,
				session.dir,
				session.id,
				parsed.collectors,
			);
			process.stderr.write(
				`backend-doctor probe: trace written to ${session.dir}\n`,
			);

			if (probeSignal !== undefined) {
				resolve(signalExitCode(probeSignal));
			} else if (signal !== null) {
				resolve(signalExitCode(signal));
			} else {
				resolve(code ?? 0);
			}
		});
	});
}
