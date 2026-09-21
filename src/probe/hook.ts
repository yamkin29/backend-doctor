// Probe preload (spec 018 lifecycle, spec 019 collectors) — loaded via
// `node --require …/register.cjs` inside the user's app. Everything here runs
// in the host process: it must never crash the app and never install handlers
// that change its semantics (constitution §7); loudness is the probe parent's
// job, not the hook's. This file is a standalone build entry and must not
// import from src/probe/* (spec 018 design decision 9) — the event shapes
// mirror src/probe/types.ts by hand.

import fs from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import process from "node:process";

interface ProbeEvent {
	type: string;
	timestamp: string;
	pid: number;
	[key: string]: unknown;
}

interface CollectorSettings {
	blockThresholdMs: number;
	lagIntervalMs: number;
}

const NOTICE_PREFIX = "backend-doctor probe:";
const MIN_LAG_INTERVAL_MS = 50;

const attachFlag = globalThis as { __backendDoctorProbeHook?: boolean };
let recordable = true;
// Set by the lag collector; the exit listener flushes the final window.
let flushLag: ((final: boolean) => void) | null = null;

function notice(message: string): void {
	try {
		process.stderr.write(`${NOTICE_PREFIX} ${message}\n`);
	} catch {
		// stderr unavailable — nothing left to do inside the host process.
	}
}

function writeEvent(event: ProbeEvent): void {
	if (!recordable) return;
	const eventsPath = process.env.BACKEND_DOCTOR_PROBE_EVENTS;
	if (eventsPath === undefined || eventsPath === "") return;
	try {
		// One appendFileSync per event: O_APPEND keeps concurrent writes from
		// descendant processes line-atomic on POSIX.
		fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
	} catch (error) {
		recordable = false;
		notice(
			`could not record events (${(error as Error).message}); staying inert`,
		);
	}
}

// ---- collectors (spec 019) ----

/** Histogram percentiles are nanoseconds; ms with 3 decimals keeps bytes short. */
function msRound(nanoseconds: number): number {
	return Math.round(nanoseconds / 1000) / 1000;
}

/**
 * Collectors are active only when the probe parent injected a valid settings
 * block. Absent = silent lifecycle-only mode (a legitimate hand-rolled F018
 * setup); present but invalid = one notice, then the same lifecycle-only mode.
 */
function parseCollectors(raw: string | undefined): {
	settings: CollectorSettings | null;
	malformed: boolean;
} {
	if (raw === undefined || raw === "") {
		return { settings: null, malformed: false };
	}
	try {
		const value = JSON.parse(raw) as Partial<CollectorSettings> | null;
		if (
			typeof value === "object" &&
			value !== null &&
			typeof value.blockThresholdMs === "number" &&
			Number.isFinite(value.blockThresholdMs) &&
			value.blockThresholdMs > 0 &&
			typeof value.lagIntervalMs === "number" &&
			Number.isFinite(value.lagIntervalMs) &&
			value.lagIntervalMs >= MIN_LAG_INTERVAL_MS
		) {
			return {
				settings: {
					blockThresholdMs: value.blockThresholdMs,
					lagIntervalMs: value.lagIntervalMs,
				},
				malformed: false,
			};
		}
	} catch {
		// malformed JSON — reported by the malformed flag below
	}
	return { settings: null, malformed: true };
}

/**
 * Loop-lag collector: two IntervalHistograms — a per-window one reset after
 * every flush, and a never-reset cumulative one whose snapshot rides along on
 * every event (so even a process killed before its second window reports
 * exact totals). The window timer is unref'd: it never keeps the host alive.
 */
function installLagMonitor(settings: CollectorSettings): void {
	const windowHist = monitorEventLoopDelay({ resolution: 10 });
	const totalHist = monitorEventLoopDelay({ resolution: 10 });
	const totalSnapshot = () => ({
		count: totalHist.count,
		p50Ms: msRound(totalHist.percentile(50)),
		p99Ms: msRound(totalHist.percentile(99)),
		maxMs: msRound(totalHist.max),
	});
	flushLag = (final: boolean): void => {
		writeEvent({
			type: "loop.lag",
			timestamp: new Date().toISOString(),
			pid: process.pid,
			periodMs: settings.lagIntervalMs,
			count: windowHist.count,
			p50Ms: msRound(windowHist.percentile(50)),
			p99Ms: msRound(windowHist.percentile(99)),
			maxMs: msRound(windowHist.max),
			final,
			total: totalSnapshot(),
		});
		windowHist.reset();
	};
	const timer = setInterval(() => {
		try {
			if (flushLag !== null) flushLag(false);
		} catch {
			// never into the host (§7)
		}
	}, settings.lagIntervalMs);
	timer.unref();
}

function installCollectors(settings: CollectorSettings): void {
	installLagMonitor(settings);
	// The blocking-call collector lands with spec 019 T4.
}

if (attachFlag.__backendDoctorProbeHook) {
	// Already attached in this process (double require) — no second attach.
} else {
	attachFlag.__backendDoctorProbeHook = true;
	if (process.env.BACKEND_DOCTOR_PROBE_EVENTS) {
		const collectors = parseCollectors(
			process.env.BACKEND_DOCTOR_PROBE_COLLECTORS,
		);
		if (collectors.malformed) {
			notice(
				"invalid collectors settings (BACKEND_DOCTOR_PROBE_COLLECTORS); recording lifecycle events only",
			);
		}
		writeEvent({
			type: "probe.attach",
			timestamp: new Date().toISOString(),
			pid: process.pid,
			ppid: process.ppid,
			nodeVersion: process.version,
			argv: [...process.argv],
			...(collectors.settings !== null
				? { collectors: collectors.settings }
				: {}),
		});
		if (collectors.settings !== null) {
			try {
				installCollectors(collectors.settings);
			} catch (error) {
				notice(
					`collectors failed to install (${(error as Error).message}); recording lifecycle events only`,
				);
			}
		}
		// Fires on normal exit and process.exit(); a default-disposition signal
		// death has no detach line — session.json's exit field is the
		// authoritative record (spec 018 design decision 5). Everything in this
		// listener is synchronous; the flush is guarded so it can never alter
		// the app's exit.
		process.on("exit", (code) => {
			if (flushLag !== null) {
				try {
					flushLag(true);
				} catch {
					// the app's exit code is not ours to change
				}
			}
			writeEvent({
				type: "probe.detach",
				timestamp: new Date().toISOString(),
				pid: process.pid,
				reason: "exit",
				code: typeof code === "number" ? code : 0,
			});
		});
	} else {
		notice("loaded outside a probe session; staying inert");
	}
}
