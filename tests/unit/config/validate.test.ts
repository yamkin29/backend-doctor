import { describe, expect, it } from "vitest";
import { ConfigError } from "../../../src/config/errors.js";
import type { UserConfig } from "../../../src/config/types.js";
import { validateUserConfig } from "../../../src/config/validate.js";

const LABEL = "backend-doctor.config.ts";
const NO_RULES = new Set<string>();

function validate(
	config: unknown,
	knownRuleIds: ReadonlySet<string> = NO_RULES,
) {
	return validateUserConfig(config, { knownRuleIds, sourceLabel: LABEL });
}

describe("validateUserConfig", () => {
	it("accepts a fully populated valid config", () => {
		const config: UserConfig = {
			rules: { "backend-doctor/no-demo": "warn" },
			categories: { Bugs: "error", Security: "off" },
			ignore: { files: ["dist/**", "coverage/**"], rules: [] },
		};
		expect(validate(config, new Set(["backend-doctor/no-demo"]))).toEqual(
			config,
		);
	});

	it("accepts an empty object and normalizes nothing away", () => {
		expect(validate({})).toEqual({});
	});

	it("rejects non-object configs", () => {
		expect(() => validate(42)).toThrow(ConfigError);
		expect(() => validate(42)).toThrow(LABEL);
	});

	it("rejects unknown rule ids in rules", () => {
		expect(() => validate({ rules: { "backend-doctor/nope": "off" } })).toThrow(
			/unknown rule id/,
		);
		expect(() => validate({ rules: { "backend-doctor/nope": "off" } })).toThrow(
			/rules\["backend-doctor\/nope"\]/,
		);
	});

	it("accepts rule ids present in the injected registry", () => {
		expect(
			validate(
				{ rules: { "backend-doctor/known": "error" } },
				new Set(["backend-doctor/known"]),
			),
		).toEqual({ rules: { "backend-doctor/known": "error" } });
	});

	it("rejects unknown rule ids in ignore.rules", () => {
		expect(() =>
			validate({ ignore: { rules: ["backend-doctor/ghost"] } }),
		).toThrow(/ignore\.rules/);
		expect(() =>
			validate({ ignore: { rules: ["backend-doctor/ghost"] } }),
		).toThrow(/backend-doctor\/ghost/);
	});

	it("rejects unknown category names", () => {
		expect(() => validate({ categories: { Nope: "warn" } })).toThrow(
			/categories\["Nope"\]/,
		);
		expect(() => validate({ categories: { Nope: "warn" } })).toThrow(
			/unknown category/,
		);
	});

	it("rejects invalid severity values", () => {
		expect(() =>
			validate(
				{ rules: { "backend-doctor/a": "fatal" } },
				new Set(["backend-doctor/a"]),
			),
		).toThrow(/rules\["backend-doctor\/a"\]/);
		expect(() => validate({ categories: { Bugs: "fatal" } })).toThrow(
			/categories\["Bugs"\]/,
		);
	});

	it("rejects non-string-array ignore fields", () => {
		expect(() => validate({ ignore: { files: "src" } })).toThrow(
			/ignore\.files/,
		);
		expect(() => validate({ ignore: { rules: [1, 2] } })).toThrow(
			/ignore\.rules/,
		);
	});

	it("rejects non-object ignore", () => {
		expect(() => validate({ ignore: ["dist/**"] })).toThrow(/ignore/);
	});
});
