import {
	type CallExpression,
	type Expression,
	Node,
	SyntaxKind,
	type TaggedTemplateExpression,
} from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";
import { PRISMA_RAW_QUERIES, unwrapParens } from "./prisma-calls.js";

/**
 * The `*Unsafe` variants accept an arbitrary string — any non-literal
 * argument is untracked provenance. The plain `$queryRaw`/`$executeRaw`
 * forms are flagged only on provably-dynamic text (spec 012, design
 * decision 4).
 */
const UNSAFE_VARIANTS = new Set(["$queryRawUnsafe", "$executeRawUnsafe"]);

/**
 * Flags dynamic text handed to a raw-query API (spec 012 AC-2): template
 * literals with interpolations and `+` concatenations are injection
 * vectors. The safe forms stay silent — the tagged-template call
 * (`` prisma.$queryRaw`…` ``) is not a CallExpression and never reaches
 * this rule, a `Prisma.sql` argument is parameterized composition, and
 * literal strings / span-free templates carry nothing to inject. Runs at
 * every scope: an injection path does not become safe at module top level
 * (the spec 007 precedent).
 */
export const noUnsafeRawQuery = defineRule({
	id: "backend-doctor/no-unsafe-raw-query",
	title: "No dynamic raw SQL",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-unsafe-raw-query.md",
	frameworks: ["prisma"],
	create(ctx) {
		const candidates = findModuleApiCalls(ctx.file, {
			names: PRISMA_RAW_QUERIES,
			insideFunctionBodies: false,
			accept: (call, name) =>
				Node.isPropertyAccessExpression(unwrapParens(call.getExpression())) &&
				hasDynamicQueryText(call, UNSAFE_VARIANTS.has(name)),
		});
		for (const { call } of candidates) {
			ctx.report({
				node: call,
				message:
					"Raw query text is built dynamically here: interpolated input allows SQL injection. Use the tagged-template form prisma.$queryRaw`…` so values become parameters, or compose fragments with Prisma.sql / Prisma.join.",
			});
		}
	},
});

function hasDynamicQueryText(call: CallExpression, unsafe: boolean): boolean {
	const argument = call.getArguments()[0];
	if (argument === undefined) return false;
	if (Node.isSpreadElement(argument)) return unsafe;
	const expression = unwrapParens(argument as Expression);
	if (Node.isStringLiteral(expression)) return false;
	if (Node.isNoSubstitutionTemplateLiteral(expression)) return false;
	if (Node.isTemplateExpression(expression)) return true;
	if (Node.isBinaryExpression(expression)) return isDynamicConcat(expression);
	if (Node.isTaggedTemplateExpression(expression)) {
		return unsafe && !isPrismaSqlTag(expression);
	}
	return unsafe;
}

/**
 * A `+` chain is dynamic when any leaf operand is not a string literal —
 * identifiers and call results are untracked provenance (the
 * `containsRequestInput` walk, spec 007).
 */
function isDynamicConcat(expression: Expression): boolean {
	const expr = unwrapParens(expression);
	if (!Node.isBinaryExpression(expr)) return !Node.isStringLiteral(expr);
	if (expr.getOperatorToken().getKind() !== SyntaxKind.PlusToken) {
		return false;
	}
	return isDynamicConcat(expr.getLeft()) || isDynamicConcat(expr.getRight());
}

/** True for the `Prisma.sql` tagged template — parameterized composition. */
function isPrismaSqlTag(tagged: TaggedTemplateExpression): boolean {
	const tag = unwrapParens(tagged.getTag());
	return (
		Node.isPropertyAccessExpression(tag) &&
		tag.getName() === "sql" &&
		tag.getExpression().getText() === "Prisma"
	);
}
