import { defineProjectRule } from "../../engine/registry.js";

/**
 * Flags analyzed files that no entry point reaches through import edges
 * (spec 013 AC-2) — dead code that is still compiled, type-checked and
 * maintained. Silent when the project has no entry file at all: without
 * entries reachability proves nothing (precision over recall,
 * constitution §2).
 */
export const unusedFile = defineProjectRule({
	id: "backend-doctor/unused-file",
	title: "No unreachable files",
	category: "Maintainability",
	severity: "warn",
	docs: "docs/rules/backend-doctor/unused-file.md",
	analyze(project) {
		if (project.entries.length === 0) return;
		const reachable = project.graph.reachableFrom(project.entries);
		for (const filePath of project.graph.files) {
			if (reachable.has(filePath)) continue;
			project.report({
				filePath,
				line: 1,
				column: 1,
				message:
					"No entry point reaches this file through imports; it is compiled and maintained but never runs. Delete it, expose it through an entry, or import it where it is meant to be used.",
			});
		}
	},
});
