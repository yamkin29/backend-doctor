import fs from "node:fs";
import path from "node:path";
import { defineProjectRule } from "../../engine/registry.js";
import { isCoveredByGitignore } from "./gitignore.js";

/**
 * The standard dotenv candidate names (spec 014): presence at the package
 * root is the check, never content. `.env.example`-style names are not
 * candidates — committed templates are the fix the message asks for.
 */
const DOTENV_CANDIDATES = [
	".env",
	".env.local",
	".env.development",
	".env.development.local",
	".env.production",
	".env.production.local",
	".env.test",
	".env.test.local",
];

function committedEnvMessage(name: string): string {
	return `${name} exists at the package root and is not covered by .gitignore; dotenv files carry real credentials and end up committed by accident. Add it to .gitignore, rotate any credential it ever held, and keep a committed .env.example instead.`;
}

/**
 * Flags dotenv files that exist at the package root without `.gitignore`
 * coverage (spec 014 AC-3). Only the package-root `.gitignore` is
 * consulted (approximate semantics — see gitignore.ts); when the file is
 * missing entirely, every present candidate reports. Content is never
 * read — the engine scans TypeScript sources only.
 */
export const noCommittedEnv = defineProjectRule({
	id: "backend-doctor/no-committed-env",
	title: "No committed env file",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-committed-env.md",
	analyze(project) {
		const gitignorePath = path.join(project.packageRoot, ".gitignore");
		const gitignore = fs.existsSync(gitignorePath)
			? fs.readFileSync(gitignorePath, "utf8")
			: undefined;
		for (const name of DOTENV_CANDIDATES) {
			const filePath = path.join(project.packageRoot, name);
			if (!fs.existsSync(filePath)) continue;
			if (gitignore !== undefined && isCoveredByGitignore(name, gitignore)) {
				continue;
			}
			project.report({
				filePath,
				line: 1,
				column: 1,
				message: committedEnvMessage(name),
			});
		}
	},
});
