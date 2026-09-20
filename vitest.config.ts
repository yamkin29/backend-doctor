import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globalSetup: ["./tests/globalSetup.ts"],
		include: ["tests/**/*.test.ts"],
		// Fixture trees are data, not suites — a fixture named *.test.ts
		// (the spec 014 test-shape fixture) must not be collected as a test.
		exclude: ["tests/fixtures/**", ...defaultExclude],
	},
});
