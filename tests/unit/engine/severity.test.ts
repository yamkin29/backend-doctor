import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../../../src/config/types.js";
import type { DiagnosticCategory } from "../../../src/core/types.js";
import { resolveSeverity } from "../../../src/engine/severity.js";

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
	return {
		rules: {},
		categories: {},
		ignore: { files: [], rules: [] },
		source: { kind: "default", path: null },
		...overrides,
	};
}

const RULE = {
	ruleId: "backend-doctor/no-eval",
	category: "Security" as DiagnosticCategory,
};

describe("resolveSeverity (AC-5)", () => {
	it("falls back to the rule default when nothing is configured", () => {
		expect(
			resolveSeverity({ ...RULE, default: "warn", config: config() }),
		).toBe("warn");
	});

	it("prefers config.rules[id] over the rule default", () => {
		const cfg = config({ rules: { "backend-doctor/no-eval": "error" } });
		expect(resolveSeverity({ ...RULE, default: "warn", config: cfg })).toBe(
			"error",
		);
	});

	it("prefers config.rules[id] over config.categories[category]", () => {
		const cfg = config({
			rules: { "backend-doctor/no-eval": "warn" },
			categories: { Security: "error" },
		});
		expect(resolveSeverity({ ...RULE, default: "warn", config: cfg })).toBe(
			"warn",
		);
	});

	it("uses config.categories[category] when no rule entry exists", () => {
		const cfg = config({ categories: { Security: "error" } });
		expect(resolveSeverity({ ...RULE, default: "warn", config: cfg })).toBe(
			"error",
		);
	});

	it("returns off when the rule is switched off via rules", () => {
		const cfg = config({ rules: { "backend-doctor/no-eval": "off" } });
		expect(resolveSeverity({ ...RULE, default: "warn", config: cfg })).toBe(
			"off",
		);
	});

	it("returns off when the whole category is off", () => {
		const cfg = config({ categories: { Security: "off" } });
		expect(resolveSeverity({ ...RULE, default: "warn", config: cfg })).toBe(
			"off",
		);
	});

	it("does not leak the rule default through an off category when the rule overrides", () => {
		const cfg = config({
			rules: { "backend-doctor/no-eval": "error" },
			categories: { Security: "off" },
		});
		expect(resolveSeverity({ ...RULE, default: "warn", config: cfg })).toBe(
			"error",
		);
	});

	it("resolves the full matrix deterministically", () => {
		const matrix = [
			{ rule: undefined, category: undefined, expected: "default" },
			{ rule: "error", category: undefined, expected: "error" },
			{ rule: "warn", category: undefined, expected: "warn" },
			{ rule: "off", category: undefined, expected: "off" },
			{ rule: undefined, category: "error", expected: "error" },
			{ rule: undefined, category: "off", expected: "off" },
			{ rule: "warn", category: "error", expected: "warn" },
			{ rule: "error", category: "warn", expected: "error" },
			{ rule: "off", category: "error", expected: "off" },
		] as const;

		for (const cell of matrix) {
			const cfg = config({
				rules: cell.rule ? { "backend-doctor/no-eval": cell.rule } : {},
				categories: cell.category
					? { Security: cell.category as "error" | "warn" | "off" }
					: {},
			});
			const resolved = resolveSeverity({
				...RULE,
				default: "warn",
				config: cfg,
			});
			if (cell.expected === "default") {
				expect(resolved).toBe("warn");
			} else {
				expect(resolved).toBe(cell.expected);
			}
		}
	});
});
