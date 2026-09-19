import { Node, SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { nearestFunctionLike } from "./async-calls.js";

const LISTENER_METHODS = new Set([
	"on",
	"once",
	"addListener",
	"prependListener",
]);

/**
 * Flags `emit("error", …)` on receivers initialized from
 * `new EventEmitter()` when no error listener is registered for them — Node
 * raises an uncaught exception for unhandled `'error'` events.
 *
 * Receiver identity is binding-aware, not textual (design decision 7): a
 * variable initialized from `new EventEmitter()` is tracked by declaration,
 * and an identifier receiver resolves to its nearest same-file binding
 * first, so a same-named parameter inside another function is never confused
 * with the tracked emitter. `this.x` receivers match class properties or
 * constructor assignments initialized from `new EventEmitter()`. Keys with
 * more than one initializer are dropped (ambiguous identity).
 */
export const noUnhandledEmitterError = defineRule({
	id: "backend-doctor/no-unhandled-emitter-error",
	title: "No unhandled emitter error",
	category: "Bugs",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-unhandled-emitter-error.md",
	create(ctx) {
		const trackedByDecl = new Map<Node, string>();
		const thisKeys = new Set<string>();
		const initializerCounts = new Map<string, number>();

		ctx.file.forEachDescendant((node) => {
			const newExpr = node.asKind(SyntaxKind.NewExpression);
			if (newExpr?.getExpression().getText() !== "EventEmitter") {
				return undefined;
			}
			const parent = newExpr.getParent();
			if (
				parent &&
				Node.isVariableDeclaration(parent) &&
				Node.isIdentifier(parent.getNameNode())
			) {
				const key = parent.getNameNode().getText();
				trackedByDecl.set(parent, key);
				bump(initializerCounts, key);
				return undefined;
			}
			if (parent && Node.isPropertyDeclaration(parent)) {
				const name = parent.getName();
				if (name !== undefined) {
					const key = `this.${name}`;
					thisKeys.add(key);
					bump(initializerCounts, key);
				}
				return undefined;
			}
			if (
				parent &&
				Node.isBinaryExpression(parent) &&
				parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken
			) {
				const left = parent.getLeft();
				if (
					Node.isPropertyAccessExpression(left) &&
					left.getExpression().getText() === "this"
				) {
					const key = left.getText();
					thisKeys.add(key);
					bump(initializerCounts, key);
				}
			}
			return undefined;
		});

		// Ambiguous identity (several initializers under one key) drops out.
		const droppedKeys = new Set(
			[...initializerCounts]
				.filter(([, count]) => count > 1)
				.map(([key]) => key),
		);
		for (const key of droppedKeys) {
			thisKeys.delete(key);
		}
		for (const [decl, key] of trackedByDecl) {
			if (droppedKeys.has(key)) trackedByDecl.delete(decl);
		}

		// Scope index for identifier receivers: variables and parameters.
		const declarationsByScope = new Map<Node, Map<string, Node>>();
		ctx.file.forEachDescendant((node) => {
			if (Node.isVariableStatement(node)) {
				for (const declaration of node.getDeclarationList().getDeclarations()) {
					const nameNode = declaration.getNameNode();
					if (Node.isIdentifier(nameNode)) {
						registerDeclaration(
							declarationsByScope,
							node,
							nameNode.getText(),
							declaration,
						);
					}
				}
				return undefined;
			}
			const parameter = node.asKind(SyntaxKind.Parameter);
			if (parameter && Node.isIdentifier(parameter.getNameNode())) {
				registerDeclaration(
					declarationsByScope,
					parameter,
					parameter.getNameNode().getText(),
					parameter,
				);
			}
			return undefined;
		});

		const emitsByReceiver = new Map<string, Node[]>();
		const listeningReceivers = new Set<string>();
		ctx.file.forEachDescendant((node) => {
			const call = node.asKind(SyntaxKind.CallExpression);
			if (!call) return undefined;
			const callee = call.getExpression();
			if (!Node.isPropertyAccessExpression(callee)) return undefined;
			const receiver = callee.getExpression();
			const key = receiverKey(
				receiver,
				trackedByDecl,
				thisKeys,
				declarationsByScope,
			);
			if (!key) return undefined;
			const argument = call.getArguments()[0];
			if (
				!argument ||
				!Node.isStringLiteral(argument) ||
				argument.getLiteralText() !== "error"
			) {
				return undefined;
			}
			const method = callee.getName();
			if (method === "emit") {
				const calls = emitsByReceiver.get(key) ?? [];
				calls.push(call);
				emitsByReceiver.set(key, calls);
			} else if (LISTENER_METHODS.has(method)) {
				listeningReceivers.add(key);
			}
			return undefined;
		});

		for (const [key, calls] of emitsByReceiver) {
			if (listeningReceivers.has(key)) continue;
			for (const call of calls) {
				ctx.report({
					node: call,
					message:
						"This emitter emits 'error' with no 'error' listener registered; Node.js raises an uncaught exception for unhandled 'error' events. Register a listener or remove the emit.",
				});
			}
		}
	},
});

function bump(counts: Map<string, number>, key: string): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}

function registerDeclaration(
	declarationsByScope: Map<Node, Map<string, Node>>,
	declaringNode: Node,
	name: string,
	declarationNode: Node,
): void {
	const scope =
		nearestFunctionLike(declaringNode.getParent()) ??
		declaringNode.getSourceFile();
	let byName = declarationsByScope.get(scope);
	if (!byName) {
		byName = new Map();
		declarationsByScope.set(scope, byName);
	}
	byName.set(name, declarationNode);
}

/**
 * Resolves the receiver to its tracked key. Identifier receivers resolve
 * through the scope index (nearest binding wins), so shadowing parameters
 * are never mistaken for the tracked emitter; `this.x` receivers match the
 * property/assignment initializer key directly.
 */
function receiverKey(
	receiver: Node,
	trackedByDecl: Map<Node, string>,
	thisKeys: Set<string>,
	declarationsByScope: Map<Node, Map<string, Node>>,
): string | null {
	if (Node.isIdentifier(receiver)) {
		let current: Node | undefined = receiver;
		while (current) {
			const declaration = declarationsByScope
				.get(current)
				?.get(receiver.getText());
			if (declaration) return trackedByDecl.get(declaration) ?? null;
			current = current.getParent();
		}
		return null;
	}
	if (
		Node.isPropertyAccessExpression(receiver) &&
		receiver.getExpression().getText() === "this"
	) {
		const key = receiver.getText();
		return thisKeys.has(key) ? key : null;
	}
	return null;
}
