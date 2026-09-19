import type { Options } from "tsup";
import { defineConfig } from "tsup";

export const buildOptions: Options = {
	entry: {
		"bin/backend-doctor": "src/bin/backend-doctor.ts",
		index: "src/index.ts",
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
