// Probe preload (spec 018 lifecycle, spec 019 collectors) — loaded via
// `node --require …/register.cjs` inside the user's app. Everything here runs
// in the host process: it must never crash the app and never install handlers
// that change its semantics (constitution §7); loudness is the probe parent's
// job, not the hook's. This file is a standalone build entry and must not
// import from src/probe/* (spec 018 design decision 9) — the event shapes
// mirror src/probe/types.ts by hand.

import asyncHooks from "node:async_hooks";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import process from "node:process";
import zlib from "node:zlib";
import picomatch from "picomatch";

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
// While the hook writes an event, its own fs appends must stay invisible to
// the blocking collector (spec 019 AC-6).
let inHookWrite = false;
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
	inHookWrite = true;
	try {
		// One appendFileSync per event: O_APPEND keeps concurrent writes from
		// descendant processes line-atomic on POSIX.
		fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
	} catch (error) {
		recordable = false;
		notice(
			`could not record events (${(error as Error).message}); staying inert`,
		);
	} finally {
		inHookWrite = false;
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

// ---- blocking-call collector ----

interface StackHolder {
	stack?: unknown;
}

interface Culprit {
	file: string;
	line: number | null;
	column: number | null;
	function: string | null;
}

const ASYNC_MAP_CAP = 131072;
const ROOT_WALK_LIMIT = 64;
const CRYPTO_APIS = [
	"pbkdf2Sync",
	"scryptSync",
	"randomBytes",
	"randomFillSync",
	"generateKeyPairSync",
	"generateKeySync",
	"generatePrimeSync",
	"checkPrimeSync",
	"hkdfSync",
	"sign",
	"verify",
] as const;
const CHILD_PROCESS_APIS = ["execSync", "spawnSync", "execFileSync"] as const;

function roundMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/**
 * The `--filter` globs the parent recorded for this session (spec 018
 * metadata, spec 019 enforcement): block.call events are restricted to
 * culprit paths matching at least one glob. Absent = no restriction;
 * present but malformed = one notice, then no restriction.
 */
function parseFilters(raw: string | undefined): {
	globs: string[];
	malformed: boolean;
} {
	if (raw === undefined || raw === "") {
		return { globs: [], malformed: false };
	}
	try {
		const value: unknown = JSON.parse(raw);
		if (
			Array.isArray(value) &&
			value.every((item) => typeof item === "string")
		) {
			return { globs: value as string[], malformed: false };
		}
	} catch {
		// malformed JSON — reported by the malformed flag below
	}
	return { globs: [], malformed: true };
}

/**
 * Blocking-call collector: wraps known sync blocking APIs of node core; a
 * call taking >= blockThresholdMs records a block.call event attributed to
 * the first stack frame outside node internals and node_modules. The stack
 * is captured at call entry (cheap, unformatted) and only formatted when the
 * call turns out slow — with Error.prepareStackTrace set and restored inside
 * one synchronous block, so it is never left patched (§7).
 */
function installBlockingCollector(settings: CollectorSettings): void {
	// Async-context registry: asyncId → (type, trigger). Destroyed entries
	// are pruned; if the map ever exceeds the cap the registry simply stops
	// growing (tags become unavailable for new resources, nothing crashes).
	const asyncInfo = new Map<number, { type: string; trigger: number }>();
	const asyncHook = asyncHooks.createHook({
		init(asyncId, type, triggerAsyncId) {
			if (asyncInfo.size < ASYNC_MAP_CAP) {
				asyncInfo.set(asyncId, { type, trigger: triggerAsyncId });
			}
		},
		destroy(asyncId) {
			asyncInfo.delete(asyncId);
		},
	});
	asyncHook.enable();

	const cwd = process.cwd();

	const filters = parseFilters(process.env.BACKEND_DOCTOR_PROBE_FILTERS);
	if (filters.malformed) {
		notice(
			"invalid filter globs (BACKEND_DOCTOR_PROBE_FILTERS); recording without restrictions",
		);
	}
	// dot: true, same as the gitignore matcher — hidden directories match.
	const filterMatchers = filters.globs.map((glob) =>
		picomatch(glob, { dot: true }),
	);
	const passesFilter = (recordedPath: string): boolean =>
		filterMatchers.length === 0 ||
		filterMatchers.some((match) => match(recordedPath));

	function relativeToCwd(file: string): string {
		if (!path.isAbsolute(file)) return file;
		const rel = path.relative(cwd, file);
		if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
			return rel;
		}
		return file;
	}

	function asyncTag(): { type: string; rootType: string } | undefined {
		const info = asyncInfo.get(asyncHooks.executionAsyncId());
		if (info === undefined) return undefined;
		let rootType = info.type;
		let cursor = info.trigger;
		for (let depth = 0; depth < ROOT_WALK_LIMIT && cursor > 1; depth++) {
			const up = asyncInfo.get(cursor);
			if (up === undefined) break;
			rootType = up.type;
			cursor = up.trigger;
		}
		return { type: info.type, rootType };
	}

	function culpritFrom(sites: unknown[]): Culprit | null {
		let fallback: Culprit | null = null;
		for (const site of sites as NodeJS.CallSite[]) {
			if (site.isNative()) continue;
			const file = site.getFileName();
			if (file === null || file === "" || file.startsWith("node:")) {
				continue;
			}
			// Belt and suspenders: captureStackTrace(holder, wrapped) already
			// crops the wrapper's own frames.
			if (file.endsWith("register.cjs")) continue;
			const frame: Culprit = {
				file,
				line: site.getLineNumber(),
				column: site.getColumnNumber(),
				function: site.getFunctionName(),
			};
			if (fallback === null) fallback = frame;
			if (!file.includes("node_modules")) return frame;
		}
		return fallback;
	}

	function recordBlockCall(
		api: string,
		durationMs: number,
		holder: StackHolder,
	): void {
		const previous = Error.prepareStackTrace;
		Error.prepareStackTrace = (_error, frames) => frames;
		let sites: unknown[];
		try {
			sites = holder.stack as unknown[];
		} finally {
			Error.prepareStackTrace = previous;
		}
		const culprit = culpritFrom(sites);
		if (culprit === null) return;
		const recordedPath = relativeToCwd(culprit.file);
		if (!passesFilter(recordedPath)) return;
		const tag = asyncTag();
		writeEvent({
			type: "block.call",
			timestamp: new Date().toISOString(),
			pid: process.pid,
			api,
			durationMs,
			file: recordedPath,
			line: culprit.line,
			column: culprit.column,
			function: culprit.function,
			...(tag !== undefined ? { async: tag } : {}),
		});
	}

	let disabled = false;

	function wrap(
		moduleObject: Record<string, unknown>,
		prefix: string,
		name: string,
	): void {
		const api = `${prefix}.${name}`;
		const original = moduleObject[name];
		if (typeof original !== "function") return;
		const wrapped = function (this: unknown, ...args: unknown[]): unknown {
			if (disabled || inHookWrite) {
				return (original as (...args: unknown[]) => unknown).apply(this, args);
			}
			const holder: StackHolder = {};
			Error.captureStackTrace(holder, wrapped);
			const start = performance.now();
			try {
				return (original as (...args: unknown[]) => unknown).apply(this, args);
			} finally {
				const durationMs = performance.now() - start;
				if (durationMs >= settings.blockThresholdMs) {
					try {
						recordBlockCall(api, roundMs(durationMs), holder);
					} catch (error) {
						// One loud notice, then this collector stands down (§7/§8).
						disabled = true;
						notice(
							`blocking-call collector disabled (${(error as Error).message})`,
						);
					}
				}
			}
		};
		Object.defineProperty(wrapped, "name", {
			value: original.name,
			configurable: true,
		});
		// Non-enumerable marker: the observable "is this instrumented" probe
		// (core functions are mostly JS in lib/, so toString() cannot tell).
		Object.defineProperty(wrapped, "__backendDoctorProbeWrapped", {
			value: true,
			enumerable: false,
			configurable: true,
		});
		moduleObject[name] = wrapped;
	}

	function wrapAll(
		moduleObject: Record<string, unknown>,
		prefix: string,
		names: readonly string[],
	): void {
		for (const name of names) wrap(moduleObject, prefix, name);
	}

	// Core modules are singletons shared between require() and import(), and
	// the preload patches before user code links — so CJS and ESM named
	// imports both see the wrappers (verified on Node 22, spec 019).
	try {
		const fsMod = fs as unknown as Record<string, unknown>;
		wrapAll(
			fsMod,
			"fs",
			Object.keys(fsMod).filter(
				(key) => typeof fsMod[key] === "function" && key.endsWith("Sync"),
			),
		);
		const realpathSync = fsMod.realpathSync as Record<string, unknown>;
		if (typeof realpathSync.native === "function") {
			wrap(realpathSync, "fs.realpathSync", "native");
		}
		wrapAll(
			crypto as unknown as Record<string, unknown>,
			"crypto",
			CRYPTO_APIS,
		);
		wrapAll(
			childProcess as unknown as Record<string, unknown>,
			"child_process",
			CHILD_PROCESS_APIS,
		);
		wrapAll(
			zlib as unknown as Record<string, unknown>,
			"zlib",
			Object.keys(zlib as unknown as Record<string, unknown>).filter(
				(key) =>
					typeof (zlib as unknown as Record<string, unknown>)[key] ===
						"function" && key.endsWith("Sync"),
			),
		);
	} catch (error) {
		notice(
			`blocking-call collector failed to install (${(error as Error).message}); continuing without it`,
		);
	}
}

function installCollectors(settings: CollectorSettings): void {
	installLagMonitor(settings);
	installBlockingCollector(settings);
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
