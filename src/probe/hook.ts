// Probe preload (spec 018) — loaded via `node --require …/register.cjs`
// inside the user's app. Everything here runs in the host process: it must
// never crash the app and never install handlers that change its semantics
// (constitution §7); loudness is the probe parent's job, not the hook's.
// This file is a standalone build entry and must not import from src/probe/*
// (design decision 9) — the event shapes mirror src/probe/types.ts by hand.

import fs from "node:fs";
import process from "node:process";

interface ProbeEvent {
	type: string;
	timestamp: string;
	pid: number;
	[key: string]: unknown;
}

const NOTICE_PREFIX = "backend-doctor probe:";

const attachFlag = globalThis as { __backendDoctorProbeHook?: boolean };
let recordable = true;

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

if (attachFlag.__backendDoctorProbeHook) {
	// Already attached in this process (double require) — no second attach.
} else {
	attachFlag.__backendDoctorProbeHook = true;
	if (process.env.BACKEND_DOCTOR_PROBE_EVENTS) {
		writeEvent({
			type: "probe.attach",
			timestamp: new Date().toISOString(),
			pid: process.pid,
			ppid: process.ppid,
			nodeVersion: process.version,
			argv: [...process.argv],
		});
		// Fires on normal exit and process.exit(); a default-disposition signal
		// death has no detach line — session.json's exit field is the
		// authoritative record (design decision 5).
		process.on("exit", (code) => {
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
