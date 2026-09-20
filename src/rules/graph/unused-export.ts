import type { SourceFileView } from "../../engine/parser/types.js";
import { Node, SyntaxKind } from "../../engine/parser/types.js";
import type { ProjectRuleContext } from "../../engine/project-rules.js";
import { defineProjectRule } from "../../engine/registry.js";

/**
 * One walk per file collects usage (spec 013 design decision 4): a named
 * import or named re-export uses exactly those names of the target;
 * default imports use `default`; namespace imports, side-effect imports,
 * `require`, dynamic `import()` and `export *` use everything (`"*"`).
 * A second walk collects the file's own exports — `export`-keyword
 * declarations, local `export { … }` lists and `export default`;
 * pass-through re-exports (`export … from`) are usage of the target, not
 * exports of the re-exporting file.
 */
export const unusedExport = defineProjectRule({
	id: "backend-doctor/unused-export",
	title: "No unused exports",
	category: "Maintainability",
	severity: "warn",
	docs: "docs/rules/backend-doctor/unused-export.md",
	analyze(project) {
		// Without entry files the public-surface boundary is unknown —
		// flagging every import-less export would cry wolf (constitution §2;
		// same precision gate as unused-file, recorded as an AC-3 note).
		if (project.entries.length === 0) return;
		const entrySet = new Set(project.entries);
		const usedBy = collectUsage(project);
		for (const filePath of project.graph.files) {
			if (entrySet.has(filePath)) continue;
			const view = project.files.find((file) => file.filePath === filePath);
			if (!view) continue;
			const used = usedBy.get(filePath);
			for (const exported of collectExports(view)) {
				if (used?.has(exported.name) || used?.has(ALL_NAMES)) continue;
				const position = project.positionOf(view, exported.node);
				project.report({
					filePath,
					line: position.line,
					column: position.column,
					message: `${exported.name} is exported here but no other file imports it; it is public API nobody uses. Remove the export keyword, inline the code, or delete it.`,
				});
			}
		}
	},
});

/** Wildcard meaning "every export of the target is used". */
const ALL_NAMES = "*";

type Usage = Map<string, Set<string>>;

function collectUsage(project: ProjectRuleContext): Usage {
	const usedBy: Usage = new Map();
	const use = (target: string | undefined, name: string): void => {
		if (!target) return;
		const names = usedBy.get(target) ?? new Set<string>();
		names.add(name);
		usedBy.set(target, names);
	};

	for (const view of project.files) {
		view.forEachDescendant((node) => {
			const importDeclaration = node.asKind(SyntaxKind.ImportDeclaration);
			if (importDeclaration) {
				const target = project.graph.resolve(
					view.filePath,
					importDeclaration.getModuleSpecifierValue(),
				);
				if (!target) return undefined;
				const clause = importDeclaration.getImportClause();
				if (!clause) {
					use(target, ALL_NAMES);
					return undefined;
				}
				if (clause.getDefaultImport()) use(target, "default");
				if (clause.getNamespaceImport()) use(target, ALL_NAMES);
				for (const named of clause.getNamedImports()) {
					// getName() is the imported (source) name: `a as b` -> "a".
					use(target, named.getName());
				}
				return undefined;
			}
			const exportDeclaration = node.asKind(SyntaxKind.ExportDeclaration);
			if (exportDeclaration) {
				const moduleSpecifier = exportDeclaration.getModuleSpecifierValue();
				if (!moduleSpecifier) return undefined;
				const target = project.graph.resolve(view.filePath, moduleSpecifier);
				if (!target) return undefined;
				const namedExports = exportDeclaration.getNamedExports();
				if (namedExports.length === 0) {
					use(target, ALL_NAMES);
					return undefined;
				}
				for (const named of namedExports) {
					use(target, named.getName());
				}
				return undefined;
			}
			const call = node.asKind(SyntaxKind.CallExpression);
			if (call) {
				const expression = call.getExpression();
				const isRequire =
					Node.isIdentifier(expression) && expression.getText() === "require";
				const isDynamicImport =
					expression.getKind() === SyntaxKind.ImportKeyword;
				if (!isRequire && !isDynamicImport) return undefined;
				const argument = call.getArguments()[0];
				if (argument && Node.isStringLiteral(argument)) {
					use(
						project.graph.resolve(
							view.filePath,
							argument.getText().slice(1, -1),
						),
						ALL_NAMES,
					);
				}
				return undefined;
			}
			return undefined;
		});
	}
	return usedBy;
}

interface ExportedSymbol {
	readonly name: string;
	readonly node: Node;
}

const EXPORTABLE_KINDS: readonly SyntaxKind[] = [
	SyntaxKind.FunctionDeclaration,
	SyntaxKind.ClassDeclaration,
	SyntaxKind.InterfaceDeclaration,
	SyntaxKind.TypeAliasDeclaration,
	SyntaxKind.EnumDeclaration,
	SyntaxKind.VariableStatement,
];

function collectExports(view: SourceFileView): ExportedSymbol[] {
	const exports: ExportedSymbol[] = [];
	view.forEachDescendant((node) => {
		if (EXPORTABLE_KINDS.includes(node.getKind())) {
			collectFromExportable(node, exports);
			return undefined;
		}
		const exportDeclaration = node.asKind(SyntaxKind.ExportDeclaration);
		if (exportDeclaration && !exportDeclaration.getModuleSpecifierValue()) {
			for (const named of exportDeclaration.getNamedExports()) {
				// The exported name is the alias: `export { a as b }` -> "b".
				// ts-morph v28 has no alias accessor, so it comes off the
				// specifier text (RESEARCH phantom-method family).
				const text = named.getText();
				const asIndex = text.lastIndexOf(" as ");
				exports.push({
					name: asIndex === -1 ? text : text.slice(asIndex + 4),
					node: exportDeclaration,
				});
			}
			return undefined;
		}
		const assignment = node.asKind(SyntaxKind.ExportAssignment);
		if (assignment && !assignment.isExportEquals()) {
			exports.push({ name: "default", node: assignment });
		}
		return undefined;
	});
	return exports;
}

function collectFromExportable(node: Node, exports: ExportedSymbol[]): void {
	const collect = (
		hasExport: boolean,
		isDefault: boolean,
		name: string | undefined,
	): void => {
		if (!hasExport) return;
		if (isDefault) {
			exports.push({ name: "default", node });
			return;
		}
		if (name !== undefined) exports.push({ name, node });
	};
	if (Node.isFunctionDeclaration(node)) {
		collect(node.hasExportKeyword(), node.isDefaultExport(), node.getName());
		return;
	}
	if (Node.isClassDeclaration(node)) {
		collect(node.hasExportKeyword(), node.isDefaultExport(), node.getName());
		return;
	}
	if (Node.isInterfaceDeclaration(node)) {
		collect(node.hasExportKeyword(), node.isDefaultExport(), node.getName());
		return;
	}
	if (Node.isTypeAliasDeclaration(node)) {
		collect(node.hasExportKeyword(), node.isDefaultExport(), node.getName());
		return;
	}
	if (Node.isEnumDeclaration(node)) {
		collect(node.hasExportKeyword(), node.isDefaultExport(), node.getName());
		return;
	}
	if (Node.isVariableStatement(node)) {
		if (!node.hasExportKeyword()) return;
		if (node.isDefaultExport()) {
			exports.push({ name: "default", node });
			return;
		}
		for (const variable of node.getDeclarationList().getDeclarations()) {
			const nameNode = variable.getNameNode();
			if (Node.isIdentifier(nameNode)) {
				exports.push({ name: nameNode.getText(), node });
			}
		}
	}
}
