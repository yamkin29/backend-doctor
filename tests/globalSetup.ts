import { build } from "tsup";
import { allBuildOptions } from "../tsup.config.js";

export default async function globalSetup(): Promise<void> {
	for (const options of allBuildOptions) {
		// config: false — tsup's programmatic build() still auto-loads
		// tsup.config.ts otherwise, and merging that ARRAY config with these
		// inline options pollutes dist: every esm entry also emits an ESM-code
		// .cjs twin and the cjs hook entry gains a .d.cts. The CLI is immune,
		// so without this flag `pnpm test` and `pnpm build` produced different
		// dist trees (and would produce different npm tarballs). Recorded in
		// docs/RESEARCH.md.
		await build({ ...options, config: false, silent: true });
	}
}
