import { Node, SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { isSecretLiteral, isSecretName } from "./secrets.js";

/**
 * The declaration's reported position source; the name may be an Identifier
 * or (object keys) a StringLiteral. Binding patterns carry no name and are
 * skipped.
 */
function declaredName(nameNode: Node): string | undefined {
	if (Node.isIdentifier(nameNode)) return nameNode.getText();
	const literal = nameNode.asKind(SyntaxKind.StringLiteral);
	return literal ? literal.getLiteralText() : undefined;
}

/**
 * Flags literals that clear both thresholds (length ≥ 16, entropy ≥ 3.0
 * bits) under secret-shaped names (spec 007, open question 4). No module
 * gate — a secret has no import — and no top-level exemption. Non-literal
 * initializers (process.env, computed values) are the fix, not a finding.
 */
export const noHardcodedSecrets = defineRule({
	id: "backend-doctor/no-hardcoded-secrets",
	title: "No hardcoded secrets",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-hardcoded-secrets.md",
	create(ctx) {
		ctx.file.forEachDescendant((node) => {
			let nameNode: Node | undefined;
			let initializer: Node | undefined;
			const variable = node.asKind(SyntaxKind.VariableDeclaration);
			if (variable) {
				nameNode = variable.getNameNode();
				initializer = variable.getInitializer();
			}
			const property = node.asKind(SyntaxKind.PropertyDeclaration);
			if (property) {
				nameNode = property.getNameNode();
				initializer = property.getInitializer();
			}
			const assignment = node.asKind(SyntaxKind.PropertyAssignment);
			if (assignment) {
				nameNode = assignment.getNameNode();
				initializer = assignment.getInitializer();
			}
			if (!nameNode || !initializer) return undefined;
			const literal = initializer.asKind(SyntaxKind.StringLiteral);
			if (!literal) return undefined;
			const name = declaredName(nameNode);
			if (!name || !isSecretName(name)) return undefined;
			if (!isSecretLiteral(literal.getLiteralText())) return undefined;
			ctx.report({
				node,
				message:
					"This looks like a hardcoded secret; anyone with the source has the credential. Load it from the environment or a secret manager instead.",
			});
			return undefined;
		});
	},
});
