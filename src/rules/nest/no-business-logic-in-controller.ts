import { Node, SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";

/**
 * Branch points counted per handler body (spec 010 AC-4): if statements,
 * loops, case clauses and conditional expressions. `DefaultClause` is not a
 * branch (cyclomatic precedent — it is the fall-through path); logical
 * operators are not counted.
 */
const BRANCH_KINDS = new Set([
	SyntaxKind.IfStatement,
	SyntaxKind.ForStatement,
	SyntaxKind.ForOfStatement,
	SyntaxKind.ForInStatement,
	SyntaxKind.WhileStatement,
	SyntaxKind.DoStatement,
	SyntaxKind.ConditionalExpression,
	SyntaxKind.CaseClause,
]);

const THRESHOLD = 2;

/**
 * Flags verb-decorated controller handlers whose body holds ≥ 2 branch
 * points: branching is business logic that belongs in a service (spec 010
 * AC-4). Handlers are (className, handlerName) pairs from the Nest model;
 * the reported position is the handler's stored one. Guard clauses — a
 * single if throwing or returning early — stay silent.
 */
export const noBusinessLogicInController = defineRule({
	id: "backend-doctor/no-business-logic-in-controller",
	title: "Business logic in controller",
	category: "Architecture",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-business-logic-in-controller.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		const handlerPositions = new Map<
			string,
			{ line: number; column: number }
		>();
		for (const controller of model.controllers) {
			if (controller.filePath !== ctx.file.filePath) continue;
			for (const handler of controller.handlers) {
				handlerPositions.set(`${controller.className}#${handler.name}`, {
					line: handler.line,
					column: handler.column,
				});
			}
		}
		if (handlerPositions.size === 0) return;

		ctx.file.forEachDescendant((node) => {
			const method = node.asKind(SyntaxKind.MethodDeclaration);
			if (!method) return undefined;
			const parent = method.getParent();
			if (!parent || !Node.isClassDeclaration(parent)) return undefined;
			const className = parent.getName();
			if (!className) return undefined;
			const position = handlerPositions.get(`${className}#${method.getName()}`);
			if (!position) return undefined;

			let branchPoints = 0;
			method.forEachDescendant((inner) => {
				if (BRANCH_KINDS.has(inner.getKind())) branchPoints += 1;
				return undefined;
			});
			if (branchPoints < THRESHOLD) return undefined;
			ctx.report({
				line: position.line,
				column: position.column,
				message: `${method.getName()} in ${className} carries ${branchPoints} branch points; this reads as business logic living in the controller. Move the branching into a service and keep the handler a thin delegation.`,
			});
			return undefined;
		});
	},
});
