import type { DiagnosticCategory } from "../core/types.js";

export type SeverityOverride = "error" | "warn" | "off";

/** Shape users write (via defineConfig or plain objects). All fields optional. */
export interface UserConfig {
	rules?: Record<string, SeverityOverride>;
	categories?: Partial<Record<DiagnosticCategory, SeverityOverride>>;
	ignore?: { files?: string[]; rules?: string[] };
}

export interface ConfigSource {
	kind: "default" | "file" | "packageJson";
	/** Absolute path of the config file / package.json; null for defaults. */
	path: string | null;
}

/** Normalized, validated config the engine (F003) will consume. */
export interface ResolvedConfig {
	rules: Record<string, SeverityOverride>;
	categories: Partial<Record<DiagnosticCategory, SeverityOverride>>;
	ignore: { files: string[]; rules: string[] };
	source: ConfigSource;
}

export function defaultConfig(): ResolvedConfig {
	return {
		rules: {},
		categories: {},
		ignore: { files: [], rules: [] },
		source: { kind: "default", path: null },
	};
}
