import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globalSetup: ["./tests/globalSetup.ts"],
		include: ["tests/**/*.test.ts"],
		// Fixture trees are data, not suites — a fixture named *.test.ts
		// (the spec 014 test-shape fixture) must not be collected as a test.
		exclude: ["tests/fixtures/**", ...defaultExclude],
		// The pretty reporter colorizes through picocolors, whose detection
		// turns colors ON whenever the CI env var is set — even piped, as in
		// GitHub Actions — so byte-pinned assertions on its output fail in CI
		// while passing locally. A non-empty NO_COLOR wins unconditionally in
		// picocolors; it is set on the worker's process.env before test files
		// load and inherited by every spawned CLI child.
		env: { NO_COLOR: "1" },
	},
});
