import { DIAGNOSTIC_CATEGORIES } from "../core/types.js";
import { ConfigError } from "./errors.js";
import type {
	ConfigSource,
	ResolvedConfig,
	SeverityOverride,
	UserConfig,
} from "./types.js";

const SEVERITIES: readonly SeverityOverride[] = ["error", "warn", "off"];
const CATEGORIES: readonly string[] = DIAGNOSTIC_CATEGORIES;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldError(
	sourceLabel: string,
	fieldPath: string,
	reason: string,
): ConfigError {
	return new ConfigError(`${sourceLabel}: ${fieldPath} — ${reason}`);
}

function checkSeverity(
	value: unknown,
	sourceLabel: string,
	fieldPath: string,
): SeverityOverride {
	if (!SEVERITIES.includes(value as SeverityOverride)) {
		throw fieldError(
			sourceLabel,
			fieldPath,
			`must be one of ${SEVERITIES.map((s) => `"${s}"`).join(", ")}`,
		);
	}
	return value as SeverityOverride;
}

function checkRuleId(
	id: string,
	knownRuleIds: ReadonlySet<string>,
	sourceLabel: string,
	fieldPath: string,
): void {
	if (!knownRuleIds.has(id)) {
		throw fieldError(
			sourceLabel,
			fieldPath,
			"unknown rule id (is it registered?)",
		);
	}
}

/**
 * Validates an unknown value against the UserConfig shape. Throws ConfigError
 * with field-path messages (`rules["backend-doctor/x"] — unknown rule id`).
 * Unknown top-level keys are ignored so the surface stays additive
 * (constitution §5).
 */
export function validateUserConfig(
	input: unknown,
	opts: { knownRuleIds: ReadonlySet<string>; sourceLabel: string },
): UserConfig {
	const { knownRuleIds, sourceLabel } = opts;

	if (!isObject(input)) {
		throw fieldError(sourceLabel, "(root)", "config must be an object");
	}

	if (input.rules !== undefined) {
		if (!isObject(input.rules)) {
			throw fieldError(sourceLabel, "rules", "must be an object");
		}
		for (const [id, value] of Object.entries(input.rules)) {
			checkRuleId(id, knownRuleIds, sourceLabel, `rules["${id}"]`);
			checkSeverity(value, sourceLabel, `rules["${id}"]`);
		}
	}

	if (input.categories !== undefined) {
		if (!isObject(input.categories)) {
			throw fieldError(sourceLabel, "categories", "must be an object");
		}
		for (const [name, value] of Object.entries(input.categories)) {
			if (!CATEGORIES.includes(name)) {
				throw fieldError(
					sourceLabel,
					`categories["${name}"]`,
					"unknown category",
				);
			}
			checkSeverity(value, sourceLabel, `categories["${name}"]`);
		}
	}

	if (input.ignore !== undefined) {
		if (!isObject(input.ignore)) {
			throw fieldError(sourceLabel, "ignore", "must be an object");
		}
		if (input.ignore.files !== undefined) {
			const files = input.ignore.files;
			if (!Array.isArray(files) || files.some((g) => typeof g !== "string")) {
				throw fieldError(
					sourceLabel,
					"ignore.files",
					"must be an array of strings",
				);
			}
		}
		if (input.ignore.rules !== undefined) {
			const rules = input.ignore.rules;
			if (!Array.isArray(rules) || rules.some((r) => typeof r !== "string")) {
				throw fieldError(
					sourceLabel,
					"ignore.rules",
					"must be an array of strings",
				);
			}
			for (const id of rules as string[]) {
				if (!knownRuleIds.has(id)) {
					throw fieldError(
						sourceLabel,
						"ignore.rules",
						`unknown rule id "${id}"`,
					);
				}
			}
		}
	}

	return input as UserConfig;
}

/** Normalizes a validated UserConfig into a fully populated ResolvedConfig. */
export function normalizeConfig(
	config: UserConfig,
	source: ConfigSource,
): ResolvedConfig {
	return {
		rules: { ...config.rules },
		categories: { ...config.categories },
		ignore: {
			files: [...(config.ignore?.files ?? [])],
			rules: [...(config.ignore?.rules ?? [])],
		},
		source,
	};
}
