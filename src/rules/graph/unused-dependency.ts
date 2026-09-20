import path from "node:path";
import { defineProjectRule } from "../../engine/registry.js";

/**
 * Non-registry protocols (`workspace:`, `file:`, `link:`, git URLs) carry
 * no published package — excluding them keeps monorepos and vendored
 * deps silent (spec 013 resolution 4).
 */
const PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Flags `package.json` `dependencies` entries nothing references (spec 013
 * AC-4): no analyzed module specifier equals the package name or extends
 * it (`name/...`), and no `scripts` string mentions it (bin usage).
 * `devDependencies` never fire — binaries and tooling live there — and
 * `@types/*` ships alongside the packages it types.
 */
export const unusedDependency = defineProjectRule({
	id: "backend-doctor/unused-dependency",
	title: "No unused dependencies",
	category: "Maintainability",
	severity: "warn",
	docs: "docs/rules/backend-doctor/unused-dependency.md",
	analyze(project) {
		const specifiers: string[] = [];
		for (const view of project.files) {
			specifiers.push(...view.getModuleSpecifiers());
		}
		const scripts = project.scripts;
		for (const [name, specifier] of Object.entries(project.dependencies)) {
			if (PROTOCOL_PATTERN.test(specifier)) continue;
			if (name.startsWith("@types/")) continue;
			const imported = specifiers.some(
				(candidate) => candidate === name || candidate.startsWith(`${name}/`),
			);
			if (imported) continue;
			if (scripts.some((script) => script.includes(name))) continue;
			project.report({
				filePath: path.join(project.packageRoot, "package.json"),
				line: 1,
				column: 1,
				message: `${name} is declared in dependencies but no analyzed file imports it. Remove it from package.json or move it to devDependencies if only tooling uses it.`,
			});
		}
	},
});
