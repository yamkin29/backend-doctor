import { expect, test } from "vitest";
import { buildNodeOptions } from "../../../src/probe/node-options.js";
import { parseProbeOptions } from "../../../src/probe/options.js";

function parse(overrides: {
	command?: string[];
	duration?: string;
	out?: string;
	filter?: string[];
	blockThresholdMs?: string;
	lagIntervalMs?: string;
}) {
	return parseProbeOptions({
		command: ["node", "server.js"],
		filter: [],
		...overrides,
	});
}

test("valid options parse fully", () => {
	const result = parse({
		duration: "60",
		out: "/tmp/traces",
		filter: ["**/src/**", "**/lib/**"],
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.command).toEqual(["node", "server.js"]);
	expect(result.value.durationSeconds).toBe(60);
	expect(result.value.outDir).toBe("/tmp/traces");
	expect(result.value.filters).toEqual(["**/src/**", "**/lib/**"]);
});

test("absent duration and out resolve to null; filters default empty", () => {
	const result = parse({});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.durationSeconds).toBeNull();
	expect(result.value.outDir).toBeNull();
	expect(result.value.filters).toEqual([]);
});

test("fractional seconds are allowed", () => {
	const result = parse({ duration: "1.5" });
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.durationSeconds).toBe(1.5);
});

test("missing command is a usage error", () => {
	const result = parse({ command: [] });
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.error).toContain("command");
});

test("non-numeric, zero and negative durations are usage errors", () => {
	for (const raw of ["abc", "0", "-3", ""]) {
		const result = parse({ duration: raw });
		expect(result.ok, `duration ${JSON.stringify(raw)}`).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("--duration");
	}
});

test("empty filter glob is a usage error", () => {
	const result = parse({ filter: ["**/src/**", ""] });
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.error).toContain("--filter");
});

test("collector knobs default to 20ms threshold and 1000ms interval", () => {
	const result = parse({});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.collectors).toEqual({
		blockThresholdMs: 20,
		lagIntervalMs: 1000,
	});
});

test("valid collector knobs parse into numbers", () => {
	const result = parse({ blockThresholdMs: "5", lagIntervalMs: "250" });
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.collectors).toEqual({
		blockThresholdMs: 5,
		lagIntervalMs: 250,
	});
});

test("invalid block threshold is a usage error naming the env var", () => {
	for (const raw of ["abc", "", "0", "-3", "Infinity"]) {
		const result = parse({ blockThresholdMs: raw });
		expect(result.ok, `threshold ${JSON.stringify(raw)}`).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS");
		expect(result.error).toContain(JSON.stringify(raw));
	}
});

test("invalid lag interval is a usage error naming the env var", () => {
	for (const raw of ["abc", "", "10", "49", "-50", "Infinity"]) {
		const result = parse({ lagIntervalMs: raw });
		expect(result.ok, `interval ${JSON.stringify(raw)}`).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("BACKEND_DOCTOR_PROBE_LAG_INTERVAL_MS");
		expect(result.error).toContain(JSON.stringify(raw));
	}
});

test("lag interval at the 50ms floor is valid; fractional knobs parse", () => {
	const result = parse({ lagIntervalMs: "50", blockThresholdMs: "1.5" });
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.collectors).toEqual({
		blockThresholdMs: 1.5,
		lagIntervalMs: 50,
	});
});

test("buildNodeOptions appends to an existing value without clobbering", () => {
	const merged = buildNodeOptions("--no-warnings", "/opt/hook.cjs");
	expect(merged).toBe('--no-warnings --require "/opt/hook.cjs"');
});

test("buildNodeOptions with no existing value yields just the directive", () => {
	expect(buildNodeOptions(undefined, "/opt/hook.cjs")).toBe(
		'--require "/opt/hook.cjs"',
	);
	expect(buildNodeOptions("", "/opt/hook.cjs")).toBe(
		'--require "/opt/hook.cjs"',
	);
});
