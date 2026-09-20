import type { Options } from "tsup";
import { defineConfig } from "tsup";

export const buildOptions: Options = {
	entry: {
		"bin/backend-doctor": "src/bin/backend-doctor.ts",
		index: "src/index.ts",
		// Maintainer tooling for rule docs (spec 017), not part of the user
		// CLI; whether it ships in the npm tarball is F023's decision.
		"scripts/rule-docs": "src/scripts/rule-docs.ts",
	},
	format: ["esm"],
	target: "node20",
	clean: true,
	sourcemap: false,
	splitting: false,
	dts: true,
	// jiti ships its own loader machinery; keep it external so config loading
	// uses the real runtime dependency instead of a bundled copy.
	external: ["jiti"],
};

export default defineConfig(buildOptions);
