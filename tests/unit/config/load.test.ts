import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError } from "../../../src/config/errors.js";
import { loadConfig } from "../../../src/config/load.js";

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "bd-load-"));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function mkdir(relative: string): string {
	const dir = path.join(root, relative);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function write(relative: string, content: string): string {
	const file = path.join(root, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
	return file;
}

const NO_RULES = new Set<string>();

describe("loadConfig — discovery (AC-1)", () => {
	it("finds a config file in the start directory", async () => {
		const file = write("proj/backend-doctor.config.ts", "export default {};");
		const config = await loadConfig({
			startDir: path.join(root, "proj"),
			knownRuleIds: NO_RULES,
		});
		expect(config.source).toEqual({ kind: "file", path: file });
	});

	it("walks up from a nested start directory", async () => {
		const file = write(
			"repo/backend-doctor.config.ts",
			'export default { ignore: { files: ["dist/**"] } };',
		);
		mkdir("repo/.git");
		mkdir("repo/packages/app/src");

		const config = await loadConfig({
			startDir: path.join(root, "repo/packages/app/src"),
			knownRuleIds: NO_RULES,
		});

		expect(config.source.path).toBe(file);
		expect(config.ignore.files).toEqual(["dist/**"]);
	});

	it("stops after the .git boundary — configs above the repo are not picked up", async () => {
		write("outer/backend-doctor.config.ts", "export default {};");
		mkdir("outer/repo/.git");
		mkdir("outer/repo/sub");

		const config = await loadConfig({
			startDir: path.join(root, "outer/repo/sub"),
			knownRuleIds: NO_RULES,
		});

		expect(config.source.kind).toBe("default");
	});

	it("prefers a dedicated config file over the package.json key in the same directory", async () => {
		const file = write(
			"proj/backend-doctor.config.json",
			'{ "ignore": { "files": ["from-file"] } }',
		);
		write(
			"proj/package.json",
			'{ "backendDoctor": { "ignore": { "files": ["from-pkg"] } } }',
		);

		const config = await loadConfig({
			startDir: path.join(root, "proj"),
			knownRuleIds: NO_RULES,
		});

		expect(config.source).toEqual({ kind: "file", path: file });
		expect(config.ignore.files).toEqual(["from-file"]);
	});

	it("returns defaults when nothing is found", async () => {
		mkdir("empty");

		const config = await loadConfig({
			startDir: path.join(root, "empty"),
			knownRuleIds: NO_RULES,
		});

		expect(config.source).toEqual({ kind: "default", path: null });
		expect(config.rules).toEqual({});
		expect(config.ignore).toEqual({ files: [], rules: [] });
	});
});

describe("loadConfig — sources (AC-3)", () => {
	it("loads a .ts config via jiti (default export)", async () => {
		const file = write(
			"proj/backend-doctor.config.ts",
			'export default { rules: { "backend-doctor/demo": "off" } };',
		);

		const config = await loadConfig({
			startDir: path.join(root, "proj"),
			knownRuleIds: new Set(["backend-doctor/demo"]),
		});

		expect(config.source.path).toBe(file);
		expect(config.rules).toEqual({ "backend-doctor/demo": "off" });
	});

	it("loads a .json config", async () => {
		write("proj/backend-doctor.config.json", '{ "rules": {} }');

		const config = await loadConfig({
			startDir: path.join(root, "proj"),
			knownRuleIds: NO_RULES,
		});

		expect(config.source.kind).toBe("file");
		expect(config.rules).toEqual({});
	});

	it("loads the backendDoctor key from package.json", async () => {
		const pkg = write(
			"proj/package.json",
			'{ "name": "x", "backendDoctor": { "ignore": { "files": ["coverage/**"] } } }',
		);

		const config = await loadConfig({
			startDir: path.join(root, "proj"),
			knownRuleIds: NO_RULES,
		});

		expect(config.source).toEqual({ kind: "packageJson", path: pkg });
		expect(config.ignore.files).toEqual(["coverage/**"]);
	});

	it("prefers .ts over .json when several config files exist", async () => {
		const tsFile = write("proj/backend-doctor.config.ts", "export default {};");
		write("proj/backend-doctor.config.json", "{}");

		const config = await loadConfig({
			startDir: path.join(root, "proj"),
			knownRuleIds: NO_RULES,
		});

		expect(config.source.path).toBe(tsFile);
	});
});

describe("loadConfig — registry validation", () => {
	it("rejects unknown rule ids from any loaded source", async () => {
		write(
			"proj/backend-doctor.config.ts",
			'export default { rules: { "backend-doctor/ghost": "off" } };',
		);

		await expect(
			loadConfig({ startDir: path.join(root, "proj"), knownRuleIds: NO_RULES }),
		).rejects.toThrow(ConfigError);
		await expect(
			loadConfig({ startDir: path.join(root, "proj"), knownRuleIds: NO_RULES }),
		).rejects.toThrow(/unknown rule id/);
	});
});

describe("loadConfig — explicit path (AC-2)", () => {
	it("loads exactly the given file, skipping discovery", async () => {
		mkdir("empty");
		const file = write(
			"elsewhere/my.config.ts",
			'export default { ignore: { files: ["explicit/**"] } };',
		);

		const config = await loadConfig({
			startDir: path.join(root, "empty"),
			explicitPath: file,
			knownRuleIds: NO_RULES,
		});

		expect(config.source).toEqual({ kind: "file", path: file });
		expect(config.ignore.files).toEqual(["explicit/**"]);
	});

	it("errors when the explicit path does not exist, naming the path", async () => {
		const missing = path.join(root, "does-not-exist.config.ts");

		await expect(
			loadConfig({
				startDir: root,
				explicitPath: missing,
				knownRuleIds: NO_RULES,
			}),
		).rejects.toThrow(missing);
	});
});

describe("loadConfig — module shape (AC-4)", () => {
	it("accepts a named `config` export", async () => {
		write("proj/backend-doctor.config.ts", "export const config = {};");
		const config = await loadConfig({
			startDir: path.join(root, "proj"),
			knownRuleIds: NO_RULES,
		});
		expect(config.rules).toEqual({});
	});

	it("accepts a CJS plain object export", async () => {
		write("proj/backend-doctor.config.js", "module.exports = { rules: {} };");
		const config = await loadConfig({
			startDir: path.join(root, "proj"),
			knownRuleIds: NO_RULES,
		});
		expect(config.rules).toEqual({});
	});

	it("errors naming the file when there is no default or config export", async () => {
		const file = write(
			"proj/backend-doctor.config.ts",
			"export const something = 1;",
		);
		await expect(
			loadConfig({ startDir: path.join(root, "proj"), knownRuleIds: NO_RULES }),
		).rejects.toThrow(file);
		await expect(
			loadConfig({ startDir: path.join(root, "proj"), knownRuleIds: NO_RULES }),
		).rejects.toThrow(ConfigError);
	});
});
