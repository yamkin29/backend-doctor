import type { Options } from "tsup";
import { defineConfig } from "tsup";

export const buildOptions: Options = {
	entry: ["src/bin/backend-doctor.ts"],
	format: ["esm"],
	target: "node20",
	clean: true,
	sourcemap: false,
	splitting: false,
	dts: false,
	banner: { js: "#!/usr/bin/env node" },
};

export default defineConfig(buildOptions);
