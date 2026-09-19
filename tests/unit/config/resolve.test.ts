import { describe, expect, it } from "vitest";
import { resolveCliOverrides } from "../../../src/config/resolve.js";
import { defaultConfig } from "../../../src/config/types.js";

describe("resolveCliOverrides (AC-9)", () => {
	it("returns the config unchanged when no CLI ignores are given", () => {
		const config = defaultConfig();
		config.ignore.files = ["dist/**"];

		expect(resolveCliOverrides(config, { ignoreGlobs: [] })).toEqual(config);
	});

	it("unions config ignore.files with CLI --ignore values", () => {
		const config = defaultConfig();
		config.ignore.files = ["dist/**"];

		const resolved = resolveCliOverrides(config, {
			ignoreGlobs: ["coverage/**"],
		});

		expect(resolved.ignore.files).toEqual(["dist/**", "coverage/**"]);
		// original config object stays untouched
		expect(config.ignore.files).toEqual(["dist/**"]);
	});

	it("deduplicates globs, keeping first occurrence order", () => {
		const config = defaultConfig();
		config.ignore.files = ["dist/**", "coverage/**"];

		const resolved = resolveCliOverrides(config, {
			ignoreGlobs: ["coverage/**", "node_modules/**", "dist/**"],
		});

		expect(resolved.ignore.files).toEqual([
			"dist/**",
			"coverage/**",
			"node_modules/**",
		]);
	});

	it("works from defaults (no config file)", () => {
		const resolved = resolveCliOverrides(defaultConfig(), {
			ignoreGlobs: ["tmp/**"],
		});
		expect(resolved.ignore.files).toEqual(["tmp/**"]);
	});
});
