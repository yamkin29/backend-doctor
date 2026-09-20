import type { SourceFileView } from "../../engine/parser/types.js";
import { type Node, SyntaxKind } from "../../engine/parser/types.js";
import type { ProjectRuleContext } from "../../engine/project-rules.js";
import { defineProjectRule } from "../../engine/registry.js";

/**
 * Flags every file participating in an import cycle (spec 013 AC-1). The
 * message carries the canonical chain — the lexicographically smallest
 * member first, walking sorted edges — so the whole loop is readable from
 * any one of the findings. Position: the file's first import statement
 * whose specifier resolves into the same cycle (fallback 1:1).
 */
export const circularDependency = defineProjectRule({
	id: "backend-doctor/circular-dependency",
	title: "No circular imports",
	category: "Architecture",
	severity: "warn",
	docs: "docs/rules/backend-doctor/circular-dependency.md",
	analyze(project) {
		for (const chain of project.graph.cycles()) {
			const members = new Set(chain.slice(0, -1));
			const chainText = chain
				.map((filePath) => project.relativePath(filePath))
				.join(" -> ");
			for (const member of members) {
				const view = project.files.find((file) => file.filePath === member);
				if (!view) continue;
				const position = firstCycleEdgePosition(project, view, members);
				project.report({
					filePath: member,
					line: position.line,
					column: position.column,
					message: `${chainText} form an import cycle; circular imports hide initialization order and break tree-shaking. Break the cycle by moving the shared code into a module both sides can import.`,
				});
			}
		}
	},
});

function firstCycleEdgePosition(
	project: ProjectRuleContext,
	view: SourceFileView,
	members: ReadonlySet<string>,
): { line: number; column: number } {
	for (const specifier of view.getModuleSpecifiers()) {
		const target = project.graph.resolve(view.filePath, specifier);
		if (!target || !members.has(target)) continue;
		const node = findImportNode(view, specifier);
		if (node) return project.positionOf(view, node);
	}
	return { line: 1, column: 1 };
}

function findImportNode(
	view: SourceFileView,
	specifier: string,
): Node | undefined {
	let found: Node | undefined;
	view.forEachDescendant((node) => {
		if (found) return undefined;
		const declaration = node.asKind(SyntaxKind.ImportDeclaration);
		if (declaration?.getModuleSpecifierValue() === specifier) {
			found = declaration;
		}
		return undefined;
	});
	return found;
}
