import { expect, test } from "vitest";
import { buildNodeOptions } from "../../../src/probe/node-options.js";
import { parseProbeOptions } from "../../../src/probe/options.js";

function parse(overrides: {
	command?: string[];
	duration?: string;
	out?: string;
	filter?: string[];
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
