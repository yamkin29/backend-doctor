import { SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";

/**
 * Flags `catch` clauses whose body holds zero statements and no comment —
 * the error vanishes without a trace (spec 011 AC-1). A comment-only body is
 * documented intent and stays silent (the ESLint `no-empty` precedent);
 * resolution 2. Comments are trivia, not nodes, so the test is textual: the
 * body's full text (which spans the comments inside the braces) stripped of
 * braces and whitespace must be empty. A comment *after* the closing brace is
 * outside `getFullText()` and does not silence the rule.
 */
export const noEmptyCatch = defineRule({
	id: "backend-doctor/no-empty-catch",
	title: "No empty catch",
	category: "Bugs",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-empty-catch.md",
	create(ctx) {
		ctx.file.forEachDescendant((node) => {
			const clause = node.asKind(SyntaxKind.CatchClause);
			if (!clause) return undefined;
			// ts-morph v28: the accessor is getBlock (a catch clause's block is
			// `block` in the compiler AST, not a function `body` — same
			// prototype-chain family as the while.getCondition trap).
			const block = clause.getBlock();
			if (block.getStatements().length > 0) return undefined;
			if (block.getFullText().replace(/[{}\s]/g, "") !== "") {
				return undefined;
			}
			ctx.report({
				node: clause,
				message:
					"This catch block is empty: the error disappears without a trace. Handle it, rethrow it, or write the reason for the deliberate ignore as a comment inside the block.",
			});
			return undefined;
		});
	},
});
