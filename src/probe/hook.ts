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
import http from "node:http";
import path from "node:path";
import {
	constants,
	monitorEventLoopDelay,
	PerformanceObserver,
} from "node:perf_hooks";
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
	n1Threshold: number;
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
			value.lagIntervalMs >= MIN_LAG_INTERVAL_MS &&
			typeof value.n1Threshold === "number" &&
			Number.isFinite(value.n1Threshold) &&
			value.n1Threshold > 0
		) {
			return {
				settings: {
					blockThresholdMs: value.blockThresholdMs,
					lagIntervalMs: value.lagIntervalMs,
					n1Threshold: value.n1Threshold,
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
	// Empirical (Node 22): without an explicit enable() the histograms record
	// nothing — count stays 0 and every percentile returns the floor bucket.
	windowHist.enable();
	totalHist.enable();
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
	// Per-collector isolation (spec 020 AC-7): one collector failing to
	// install must not take down the others; each notice names its collector.
	// The ALS instance is shared: the HTTP collector scopes each request into
	// a store, the DB collector reads it when a query runs.
	const requestContext = new asyncHooks.AsyncLocalStorage<{
		dbQueries: number;
	}>();
	const installs: Array<[string, () => void]> = [
		["event-loop lag", () => installLagMonitor(settings)],
		["blocking-call", () => installBlockingCollector(settings)],
		["memory/gc", () => installMemoryCollector(settings)],
		["http", () => installHttpCollector(requestContext)],
	];
	for (const [name, install] of installs) {
		try {
			install();
		} catch (error) {
			notice(
				`${name} collector failed to install (${(error as Error).message}); continuing without it`,
			);
		}
	}
}

// ---- HTTP collector (spec 020) ----

interface RequestLike extends Record<string, unknown> {}

type ServerEmit = typeof http.Server.prototype.emit;

const EMIT_MARKER = "__backendDoctorProbeEmitWrapped";

/**
 * Route attribution (spec 020 AC-2): Express sets req.route (+ req.baseUrl)
 * during dispatch, Fastify exposes routerPath (v4) or routeOptions.url (v5);
 * a RegExp route path falls through to the URL pathname without query.
 */
function routeFromRequest(req: RequestLike): string {
	const route = req.route as { path?: unknown } | undefined;
	if (route !== undefined && route !== null && typeof route.path === "string") {
		const base = typeof req.baseUrl === "string" ? req.baseUrl : "";
		return `${base}${route.path}`;
	}
	const fastifyRoute =
		req.routerPath ?? (req.routeOptions as { url?: unknown } | undefined)?.url;
	if (typeof fastifyRoute === "string") return fastifyRoute;
	const url = req.url;
	if (typeof url === "string") {
		try {
			return new URL(url, "http://localhost").pathname;
		} catch {
			return url;
		}
	}
	return "";
}

/**
 * Wraps Server.prototype.emit so every `request` dispatch runs inside a
 * fresh ALS store; the response's `finish` records one http.request event.
 * Requests that never finish (aborted) record nothing (AC-8). Verified live:
 * the original emit must be applied through a closure with the server as
 * `this` — handing the unbound method to als.run crashes the host.
 */
function installHttpCollector(
	requestContext: asyncHooks.AsyncLocalStorage<{ dbQueries: number }>,
): void {
	const originalEmit: ServerEmit = http.Server.prototype.emit;
	let disabled = false;
	// The passthrough must re-join the event name with the rest args: calling
	// the original with the rest only silently becomes emit(undefined) and
	// every listener (including "listening" and "request") never runs.
	const passthrough = function (
		this: unknown,
		event: string,
		args: unknown[],
	): unknown {
		return (originalEmit as (...emitArgs: unknown[]) => unknown).apply(this, [
			event,
			...args,
		]);
	};
	const wrappedEmit = function (
		this: unknown,
		event: string,
		...args: unknown[]
	): unknown {
		if (disabled || event !== "request") {
			return passthrough.call(this, event, args);
		}
		const req = args[0] as RequestLike | undefined;
		const res = args[1] as
			| {
					once?: (name: string, listener: () => void) => unknown;
					statusCode?: number;
			  }
			| undefined;
		if (
			req === undefined ||
			res === undefined ||
			typeof res.once !== "function"
		) {
			return passthrough.call(this, event, args);
		}
		const store = { dbQueries: 0 };
		const startedAt = performance.now();
		res.once("finish", () => {
			if (disabled) return;
			try {
				writeEvent({
					type: "http.request",
					timestamp: new Date().toISOString(),
					pid: process.pid,
					method: typeof req.method === "string" ? req.method : "",
					route: routeFromRequest(req),
					status: typeof res.statusCode === "number" ? res.statusCode : 0,
					durationMs: roundMs(performance.now() - startedAt),
					dbQueries: store.dbQueries,
				});
			} catch (error) {
				disabled = true;
				notice(`http collector disabled (${(error as Error).message})`);
			}
		});
		return requestContext.run(store, () => passthrough.call(this, event, args));
	};
	Object.defineProperty(wrappedEmit, "name", {
		value: "emit",
		configurable: true,
	});
	// Non-enumerable marker: the observable "is this instrumented" probe.
	Object.defineProperty(wrappedEmit, EMIT_MARKER, {
		value: true,
		enumerable: false,
		configurable: true,
	});
	http.Server.prototype.emit = wrappedEmit as ServerEmit;
}

// ---- memory/GC collector (spec 020) ----

/**
 * Periodic memory samples ride their own unref'd interval at the lag cadence
 * (independent of the lag collector's timer: a bug in one must not silence
 * the other); each GC the observer sees records a gc.pause event. Verified on
 * Node 22: the observer holds no event-loop reference — no unref() exists and
 * none is needed — and the GC kind lives on entry.detail (the legacy entry
 * .kind accessor is DEP0152).
 */
function installMemoryCollector(settings: CollectorSettings): void {
	const gcKindNames = new Map<number, string>([
		[constants.NODE_PERFORMANCE_GC_MINOR, "minor"],
		[constants.NODE_PERFORMANCE_GC_MAJOR, "major"],
		[constants.NODE_PERFORMANCE_GC_INCREMENTAL, "incremental"],
		[constants.NODE_PERFORMANCE_GC_WEAKCB, "weakcb"],
	]);
	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			try {
				// entry.detail exists at runtime (Node 22) but is not on the
				// @types/node PerformanceEntry — the cast documents the shape.
				const detail = (entry as unknown as { detail?: { kind?: unknown } })
					.detail;
				const kind = gcKindNames.get(Number(detail?.kind ?? -1)) ?? "other";
				writeEvent({
					type: "gc.pause",
					timestamp: new Date().toISOString(),
					pid: process.pid,
					kind,
					durationMs: roundMs(entry.duration),
				});
			} catch {
				// never into the host (§7)
			}
		}
	});
	observer.observe({ entryTypes: ["gc"] });

	const toMb = (bytes: number): number =>
		Math.round((bytes / 1048576) * 1000) / 1000;
	const timer = setInterval(() => {
		try {
			const usage = process.memoryUsage();
			writeEvent({
				type: "mem.sample",
				timestamp: new Date().toISOString(),
				pid: process.pid,
				rssMb: toMb(usage.rss),
				heapUsedMb: toMb(usage.heapUsed),
				heapTotalMb: toMb(usage.heapTotal),
				externalMb: toMb(usage.external),
			});
		} catch {
			// never into the host (§7)
		}
	}, settings.lagIntervalMs);
	timer.unref();
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
