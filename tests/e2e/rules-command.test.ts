import { describe, expect, it } from "vitest";
import { allProjectRules, allRules } from "../../src/engine/registry.js";
// Importing registers the product rules so the test sees the real set.
import "../../src/rules/index.js";
import { expectSuccess, runCli } from "./helpers.js";

/**
 * Spec 017 AC-1..AC-5: the `rules` command end-to-end against the built bin.
 * The registry imports give the test the same rule set the CLI ships with.
 */
const fileRules = allRules();
const projectRules = allProjectRules();
const total = fileRules.length + projectRules.length;

describe("rules list (spec 017 AC-1/AC-2)", () => {
	it("prints a header, one line per registered rule in registration order, and the count", () => {
		const result = runCli(["rules", "list"]);
		expectSuccess(result);

		const lines = result.stdout.split("\n");
		expect(lines).toHaveLength(total + 4); // header + rules + blank + count + trailing
		expect(lines[total + 3]).toBe("");

		expect(lines[0]).toContain("RULE ID");
		expect(lines[0]).toContain("CATEGORY");
		expect(lines[0]).toContain("SEVERITY");
		expect(lines[0]).toContain("GATE");

		const ids = [
			...fileRules.map((rule) => rule.id),
			...projectRules.map((rule) => rule.id),
		];
		ids.forEach((id, index) => {
			const line = lines[index + 1];
			expect(line?.startsWith(id), `line ${index + 1} for ${id}`).toBe(true);
		});

		expect(lines[total + 2]).toBe(`${total} rules`);
	});

	it("shows the framework gate: prisma for gated rules, - otherwise", () => {
		const result = runCli(["rules", "list"]);
		const lines = result.stdout.split("\n");
		const gated = lines.find((line) =>
			line.startsWith("backend-doctor/no-prisma-n-plus-one"),
		);
		expect(gated?.trim().split(/\s{2,}/)).toEqual([
			"backend-doctor/no-prisma-n-plus-one",
			"Performance",
			"warn",
			"prisma",
		]);
		const unconditional = lines.find((line) =>
			line.startsWith("backend-doctor/no-eval"),
		);
		expect(unconditional?.endsWith("-")).toBe(true);
	});

	it("is byte-identical across runs (AC-2)", () => {
		const first = runCli(["rules", "list"]);
		const second = runCli(["rules", "list"]);
		expect(first.stdout).toBe(second.stdout);
	});
});

describe("rules explain (spec 017 AC-3..AC-5)", () => {
	it("prints full metadata for an unconditional file rule (AC-3)", () => {
		const result = runCli(["rules", "explain", "backend-doctor/no-eval"]);
		expectSuccess(result);
		expect(result.stdout).toContain("backend-doctor/no-eval");
		expect(result.stdout).toContain("Title: No eval");
		expect(result.stdout).toContain("Category: Security");
		expect(result.stdout).toContain("Default severity: warn");
		expect(result.stdout).toContain("Kind: file rule");
		expect(result.stdout).toContain(
			"Framework gate: none — runs unconditionally",
		);
		expect(result.stdout).toContain('rules["backend-doctor/no-eval"]');
		expect(result.stdout).toContain("off | warn | error");
		expect(result.stdout).toContain(
			"Docs: docs/rules/backend-doctor/no-eval.md",
		);
	});

	it("names the frameworks for a gated rule (AC-3)", () => {
		const result = runCli([
			"rules",
			"explain",
			"backend-doctor/no-prisma-n-plus-one",
		]);
		expectSuccess(result);
		expect(result.stdout).toContain(
			"Framework gate: prisma — runs only when all are detected",
		);
	});

	it("marks project rules as running once per scan (AC-3)", () => {
		const result = runCli(["rules", "explain", "backend-doctor/unused-file"]);
		expectSuccess(result);
		expect(result.stdout).toContain("Kind: project rule");
		expect(result.stdout).toContain(
			"Docs: docs/rules/backend-doctor/unused-file.md",
		);
	});

	it("exits 2 with the id on stderr for an unregistered id (AC-4)", () => {
		const result = runCli([
			"rules",
			"explain",
			"backend-doctor/does-not-exist",
		]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("backend-doctor/does-not-exist");
		expect(result.stdout).toBe("");
	});

	it("exits 2 with nothing on stdout when the id argument is missing (AC-5)", () => {
		const result = runCli(["rules", "explain"]);
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
	});
});
