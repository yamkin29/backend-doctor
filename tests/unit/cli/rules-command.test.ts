import { describe, expect, it } from "vitest";
import {
	formatRuleExplain,
	formatRulesList,
	type RuleMeta,
} from "../../../src/cli/commands/rules.js";

/**
 * Spec 017 AC-1..AC-3 at the formatter level: the pure views over the rule
 * registry that `rules list` / `rules explain` print. The commands themselves
 * (exit codes, stdout/stderr discipline) are covered end-to-end in
 * tests/e2e/rules-command.test.ts.
 */

const fileRule: RuleMeta = {
	id: "backend-doctor/no-eval",
	title: "No eval",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-eval.md",
};

const gatedRule: RuleMeta = {
	id: "backend-doctor/no-prisma-n-plus-one",
	title: "No Prisma N+1",
	category: "Performance",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-prisma-n-plus-one.md",
	frameworks: ["prisma"],
};

const projectRule: RuleMeta = {
	id: "backend-doctor/unused-file",
	title: "Unused file",
	category: "Maintainability",
	severity: "warn",
	docs: "docs/rules/backend-doctor/unused-file.md",
};

describe("formatRulesList (spec 017 AC-1/AC-2)", () => {
	it("renders a header, one line per rule in the given order, and a count", () => {
		const out = formatRulesList([fileRule, gatedRule], [projectRule]);
		const lines = out.split("\n");
		// header + 3 rules + blank separator + summary + trailing newline
		expect(lines).toHaveLength(7);
		expect(lines[6]).toBe("");

		expect(lines[0]).toContain("RULE ID");
		expect(lines[0]).toContain("CATEGORY");
		expect(lines[0]).toContain("SEVERITY");
		expect(lines[0]).toContain("GATE");

		expect(lines[1]).toContain("backend-doctor/no-eval");
		expect(lines[2]).toContain("backend-doctor/no-prisma-n-plus-one");
		expect(lines[3]).toContain("backend-doctor/unused-file");
		expect(lines[4]).toBe("");
		expect(lines[5]).toBe("3 rules");
	});

	it("aligns columns so every data row has the same four cells", () => {
		const out = formatRulesList([fileRule, gatedRule], [projectRule]);
		const lines = out.split("\n");
		const [fileCells, gatedCells, projectCells] = lines
			.slice(1, 4)
			.map((line) => line.trim().split(/\s{2,}/));
		expect(fileCells).toEqual([
			"backend-doctor/no-eval",
			"Security",
			"warn",
			"-",
		]);
		expect(gatedCells).toEqual([
			"backend-doctor/no-prisma-n-plus-one",
			"Performance",
			"warn",
			"prisma",
		]);
		expect(projectCells).toEqual([
			"backend-doctor/unused-file",
			"Maintainability",
			"warn",
			"-",
		]);
	});

	it("is byte-identical across calls (AC-2)", () => {
		const a = formatRulesList([fileRule, gatedRule], [projectRule]);
		const b = formatRulesList([fileRule, gatedRule], [projectRule]);
		expect(a).toBe(b);
	});

	it("renders an empty registry as a header and a zero count", () => {
		const out = formatRulesList([], []);
		const lines = out.split("\n");
		expect(lines[0]).toContain("RULE ID");
		expect(out).toContain("0 rules");
	});
});

describe("formatRuleExplain (spec 017 AC-3)", () => {
	it("renders full metadata for an unconditional file rule", () => {
		const out = formatRuleExplain(fileRule, "file");
		expect(out).toContain("backend-doctor/no-eval");
		expect(out).toContain("Title: No eval");
		expect(out).toContain("Category: Security");
		expect(out).toContain("Default severity: warn");
		expect(out).toContain("Kind: file rule");
		expect(out).toContain("Framework gate: none — runs unconditionally");
		expect(out).toContain('rules["backend-doctor/no-eval"]');
		expect(out).toContain("off | warn | error");
		expect(out).toContain("Docs: docs/rules/backend-doctor/no-eval.md");
	});

	it("names the frameworks for a gated rule", () => {
		const out = formatRuleExplain(gatedRule, "file");
		expect(out).toContain(
			"Framework gate: prisma — runs only when all are detected",
		);
	});

	it("marks project rules as running once per scan", () => {
		const out = formatRuleExplain(projectRule, "project");
		expect(out).toContain("Kind: project rule");
	});
});
