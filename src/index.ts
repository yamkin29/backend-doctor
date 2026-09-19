import type { UserConfig } from "./config/types.js";

/**
 * Identity helper giving user configs full type checking:
 *
 * ```ts
 * import { defineConfig } from "backend-doctor";
 * export default defineConfig({ rules: {} });
 * ```
 */
export function defineConfig(config: UserConfig): UserConfig {
	return config;
}

export type {
	ResolvedConfig,
	SeverityOverride,
	UserConfig,
} from "./config/types.js";
