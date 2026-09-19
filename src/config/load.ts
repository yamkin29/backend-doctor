import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { ConfigError } from "./errors.js";
import {
	defaultConfig,
	type ResolvedConfig,
	type UserConfig,
} from "./types.js";
import { normalizeConfig, validateUserConfig } from "./validate.js";

const CONFIG_BASENAME = "backend-doctor.config";
const CONFIG_EXTENSIONS = [".ts", ".mts", ".js", ".mjs", ".json"] as const;
const PACKAGE_KEY = "backendDoctor";

export interface LoadConfigOptions {
	/** Scan target directory (pass the file's dirname for file targets). */
	startDir: string;
	/** Explicit --config path; skips discovery entirely. */
	explicitPath?: string;
	knownRuleIds?: ReadonlySet<string>;
}

/**
 * Discovers and loads the effective config. Walk-up stops after the nearest
 * ancestor containing `.git` (inclusive); a dedicated config file beats the
 * package.json key in the same directory; nothing found → defaults.
 */
export async function loadConfig(
	opts: LoadConfigOptions,
): Promise<ResolvedConfig> {
	const knownRuleIds = opts.knownRuleIds ?? new Set<string>();
	if (opts.explicitPath) {
		const file = path.resolve(opts.explicitPath);
		if (!fs.existsSync(file)) {
			throw new ConfigError(`Config file does not exist: ${file}`);
		}
		return loadFromFile(file, knownRuleIds);
	}
	const dir = findConfigDirectory(path.resolve(opts.startDir));
	if (!dir) return defaultConfig();

	const file = findConfigFile(dir);
	if (file) return loadFromFile(file, knownRuleIds);
	return loadFromPackageJson(path.join(dir, "package.json"), knownRuleIds);
}

function findConfigDirectory(startDir: string): string | null {
	let dir = startDir;
	for (;;) {
		if (findConfigFile(dir)) return dir;
		const pkg = path.join(dir, "package.json");
		if (fs.existsSync(pkg) && packageJsonHasKey(pkg)) return dir;
		if (fs.existsSync(path.join(dir, ".git"))) return null;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function findConfigFile(dir: string): string | null {
	for (const ext of CONFIG_EXTENSIONS) {
		const file = path.join(dir, CONFIG_BASENAME + ext);
		if (fs.existsSync(file)) return file;
	}
	return null;
}

function packageJsonHasKey(pkgPath: string): boolean {
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<
			string,
			unknown
		>;
		return pkg[PACKAGE_KEY] !== undefined;
	} catch {
		// An invalid package.json is not our config problem; skip it.
		return false;
	}
}

async function loadFromFile(
	file: string,
	knownRuleIds: ReadonlySet<string>,
): Promise<ResolvedConfig> {
	if (file.endsWith(".json")) {
		return loadJsonFile(file, knownRuleIds);
	}
	const jiti = createJiti(import.meta.url);
	let mod: unknown;
	try {
		mod = await jiti.import(file);
	} catch (error) {
		throw new ConfigError(
			`${file}: failed to load — ${(error as Error).message}`,
		);
	}
	const config = validateUserConfig(extractDefaultOrConfig(mod, file), {
		knownRuleIds,
		sourceLabel: file,
	});
	return normalizeConfig(config, { kind: "file", path: file });
}

function loadJsonFile(
	file: string,
	knownRuleIds: ReadonlySet<string>,
): ResolvedConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		throw new ConfigError(
			`${file}: invalid JSON — ${(error as Error).message}`,
		);
	}
	const config = validateUserConfig(parsed, {
		knownRuleIds,
		sourceLabel: file,
	});
	return normalizeConfig(config, { kind: "file", path: file });
}

function loadFromPackageJson(
	pkgPath: string,
	knownRuleIds: ReadonlySet<string>,
): ResolvedConfig {
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<
		string,
		unknown
	>;
	const config = validateUserConfig(pkg[PACKAGE_KEY], {
		knownRuleIds,
		sourceLabel: `${pkgPath}#${PACKAGE_KEY}`,
	});
	return normalizeConfig(config, { kind: "packageJson", path: pkgPath });
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts `export default {…}`, `export const config = {…}` or plain CJS objects. */
function extractDefaultOrConfig(mod: unknown, file: string): UserConfig {
	if (!isObject(mod)) {
		throw new ConfigError(`${file}: must export a default or config object`);
	}
	// jiti interop may expose a *virtual* `default` (the module itself) when no
	// default export exists, so only an own "default" property counts.
	const hasOwnDefault = Object.getOwnPropertyNames(mod).includes("default");
	if (hasOwnDefault && isObject(mod.default)) {
		return mod.default as UserConfig;
	}
	if (isObject(mod.config)) return mod.config as UserConfig;
	// CJS `module.exports = {…}` arrives as a plain object; transpiled ESM
	// modules without default/config are rejected instead of being mistaken
	// for a config.
	if (!isTranspiledEsModule(mod)) return mod as UserConfig;
	throw new ConfigError(`${file}: must export a default or config object`);
}

function isTranspiledEsModule(mod: Record<string, unknown>): boolean {
	if ("__esModule" in mod || "$$esModule" in mod) return true;
	const tagged = mod as { [Symbol.toStringTag]?: unknown };
	return tagged[Symbol.toStringTag] === "Module";
}
