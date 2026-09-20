import { defineRule } from "../../engine/registry.js";
import { isConfigShapedPath, isTestShapedPath } from "./config-paths.js";
import { collectEnvAccesses } from "./env-usage.js";

const MESSAGE =
	"process.env is read directly in business code; route the value through your config module so defaults and validation live in one place.";

/**
 * Flags direct `process.env` reads outside config- and test-shaped files
 * (spec 014 AC-1): scattered env access hides defaults and validation.
 * Config-shaped paths are where reads belong; tests set up the
 * environment idiomatically (spec resolution 2). One diagnostic per
 * access site, positioned at the access anchor.
 */
export const noDirectProcessEnv = defineRule({
	id: "backend-doctor/no-direct-process-env",
	title: "No direct process.env in business code",
	category: "Configuration",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-direct-process-env.md",
	create(ctx) {
		if (
			isConfigShapedPath(ctx.relativePath) ||
			isTestShapedPath(ctx.relativePath)
		) {
			return;
		}
		for (const access of collectEnvAccesses(ctx.file)) {
			ctx.report({ node: access, message: MESSAGE });
		}
	},
});
