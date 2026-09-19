import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Starter config written by `init`. Deliberately import-free so it resolves
 * before the package is published; `defineConfig` can be adopted manually.
 */
export const STARTER_CONFIG = `/** backend-doctor configuration. Severities: "error" | "warn" | "off". */
export default {
	rules: {},
	categories: {},
	ignore: {
		files: [],
		rules: [],
	},
};
`;

const CONFIG_EXTENSIONS = [".ts", ".mts", ".js", ".mjs", ".json"] as const;

export function initCommand(cwd = process.cwd()): number {
	for (const ext of CONFIG_EXTENSIONS) {
		const existing = path.join(cwd, `backend-doctor.config${ext}`);
		if (fs.existsSync(existing)) {
			process.stderr.write(`Config already exists: ${existing}\n`);
			return 2;
		}
	}
	const target = path.join(cwd, "backend-doctor.config.ts");
	fs.writeFileSync(target, STARTER_CONFIG);
	process.stdout.write(`Created ${target}\n`);
	return 0;
}
