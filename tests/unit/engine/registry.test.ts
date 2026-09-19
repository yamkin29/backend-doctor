import { beforeEach, describe, expect, it } from "vitest";
import {
	allRules,
	clearRegisteredRules,
	defineRule,
	type RuleDefinition,
	registerRule,
} from "../../../src/engine/registry.js";

function spyRule(id: string, calls: string[]): RuleDefinition {
	return defineRule({
		id,
		title: `Spy ${id}`,
		category: "Security",
		severity: "warn",
		docs: `docs/rules/${id}.md`,
		create(ctx) {
			calls.push(id);
			ctx.report({ line: 1, column: 1, message: `finding of ${id}` });
		},
	});
}

describe("registry (AC-9)", () => {
	beforeEach(() => {
		clearRegisteredRules();
	});

	it("registers rules and exposes them via allRules", () => {
		const calls: string[] = [];
		registerRule(spyRule("backend-doctor/a", calls));
		registerRule(spyRule("backend-doctor/b", calls));

		expect(allRules().map((r) => r.id)).toEqual([
			"backend-doctor/a",
			"backend-doctor/b",
		]);
	});

	it("rejects duplicate ids loudly", () => {
		const calls: string[] = [];
		registerRule(spyRule("backend-doctor/a", calls));
		expect(() => registerRule(spyRule("backend-doctor/a", calls))).toThrow(
			/backend-doctor\/a/,
		);
	});

	it("defineRule returns the definition unchanged", () => {
		const calls: string[] = [];
		const rule = spyRule("backend-doctor/c", calls);
		expect(defineRule(rule)).toBe(rule);
	});

	it("keeps the frameworks field on registered rules (spec 004)", () => {
		const calls: string[] = [];
		const packRule = defineRule({
			...spyRule("backend-doctor/nest/only", calls),
			frameworks: ["nest"],
		});
		registerRule(packRule);

		expect(allRules().at(-1)?.frameworks).toEqual(["nest"]);
	});
});
