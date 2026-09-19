import {
	type CallExpression,
	type Expression,
	Node,
	type SourceFileView,
	SyntaxKind,
} from "../../engine/parser/types.js";

/**
 * Shared async-call heuristic for spec 005 (design §1): resolves whether a
 * statement-level call targets a same-file async binding. Consumed by
 * `no-floating-promises` (call-site candidates outside constructors) and
 * `no-async-constructor-work` (the same candidates inside constructors).
 */

export interface AsyncCallCandidate {
	/** The statement-level call expression; the report position source. */
	call: CallExpression;
	/** True when the call sits directly inside a constructor body (the nearest function-like ancestor is a constructor). */
	inConstructor: boolean;
}

interface Binding {
	isAsync: boolean;
}

const FUNCTION_LIKE_KINDS: readonly SyntaxKind[] = [
	SyntaxKind.FunctionDeclaration,
	SyntaxKind.MethodDeclaration,
	SyntaxKind.Constructor,
	SyntaxKind.GetAccessor,
	SyntaxKind.SetAccessor,
	SyntaxKind.FunctionExpression,
	SyntaxKind.ArrowFunction,
];

/**
 * Collects statement-level calls whose callee resolves to async work:
 * a same-file `async` function declaration or async arrow/function expression
 * assigned to a variable (nearest scope wins, design decision 2),
 * `this.<asyncMember>()` on the enclosing class, or a bare `fetch` not
 * shadowed by any same-file binding. `void`/`await`-prefixed, chained and
 * assigned forms are never statement-level calls and produce no candidates.
 */
export function findStatementLevelAsyncCalls(
	file: SourceFileView,
): AsyncCallCandidate[] {
	const bindingsByScope = new Map<Node, Map<string, Binding>>();
	const asyncMembersByClass = new Map<Node, Set<string>>();

	file.forEachDescendant((node) => {
		if (Node.isFunctionDeclaration(node)) {
			const name = node.getName();
			if (name && node.getBody()) {
				registerBinding(bindingsByScope, node, name, node.isAsync());
			}
			return undefined;
		}
		if (Node.isVariableStatement(node)) {
			for (const declaration of node.getDeclarationList().getDeclarations()) {
				const nameNode = declaration.getNameNode();
				const initializer = declaration.getInitializer();
				const fn =
					initializer?.asKind(SyntaxKind.ArrowFunction) ??
					initializer?.asKind(SyntaxKind.FunctionExpression);
				if (Node.isIdentifier(nameNode) && fn) {
					registerBinding(
						bindingsByScope,
						node,
						nameNode.getText(),
						fn.isAsync(),
					);
				}
			}
			return undefined;
		}
		if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
			const members = new Set<string>();
			for (const method of node.getMethods()) {
				const name = method.getName();
				if (method.isAsync() && name !== undefined) members.add(name);
			}
			for (const property of node.getProperties()) {
				const name = property.getName();
				const initializer = property.getInitializer();
				const fn =
					initializer?.asKind(SyntaxKind.ArrowFunction) ??
					initializer?.asKind(SyntaxKind.FunctionExpression);
				if (fn?.isAsync() && name !== undefined) members.add(name);
			}
			asyncMembersByClass.set(node, members);
			return undefined;
		}
		return undefined;
	});

	const candidates: AsyncCallCandidate[] = [];
	file.forEachDescendant((node) => {
		const call = node.asKind(SyntaxKind.CallExpression);
		if (call && isStatementLevel(call)) {
			if (isAsyncCallee(call, bindingsByScope, asyncMembersByClass)) {
				candidates.push({ call, inConstructor: isInConstructorBody(call) });
			}
		}
		return undefined;
	});
	return candidates;
}

function registerBinding(
	bindingsByScope: Map<Node, Map<string, Binding>>,
	declarationNode: Node,
	name: string,
	isAsync: boolean,
): void {
	const scope =
		nearestFunctionLike(declarationNode.getParent()) ??
		declarationNode.getSourceFile();
	let byName = bindingsByScope.get(scope);
	if (!byName) {
		byName = new Map();
		bindingsByScope.set(scope, byName);
	}
	byName.set(name, { isAsync });
}

/** True when the call is the entire expression of an ExpressionStatement. */
function isStatementLevel(call: CallExpression): boolean {
	let parent = call.getParent();
	while (parent && Node.isParenthesizedExpression(parent)) {
		parent = parent.getParent();
	}
	return parent !== undefined && Node.isExpressionStatement(parent);
}

function isAsyncCallee(
	call: CallExpression,
	bindingsByScope: Map<Node, Map<string, Binding>>,
	asyncMembersByClass: Map<Node, Set<string>>,
): boolean {
	const callee = unwrapParens(call.getExpression());
	if (Node.isIdentifier(callee)) {
		const name = callee.getText();
		const resolved = resolveNearestBinding(call, name, bindingsByScope);
		if (resolved !== null) return resolved;
		return name === "fetch";
	}
	if (
		Node.isPropertyAccessExpression(callee) &&
		callee.getExpression().getText() === "this"
	) {
		const memberName = callee.getName();
		let current: Node | undefined = call;
		while (current) {
			if (Node.isClassDeclaration(current) || Node.isClassExpression(current)) {
				return asyncMembersByClass.get(current)?.has(memberName) ?? false;
			}
			current = current.getParent();
		}
		return false;
	}
	return false;
}

/**
 * Scope-aware lookup (design decision 2): the nearest enclosing scope that
 * binds `name` decides. Returns null when no same-file binding exists —
 * the caller applies the `fetch` fallback.
 */
function resolveNearestBinding(
	call: CallExpression,
	name: string,
	bindingsByScope: Map<Node, Map<string, Binding>>,
): boolean | null {
	let current: Node | undefined = call;
	while (current) {
		const binding = bindingsByScope.get(current)?.get(name);
		if (binding) return binding.isAsync;
		current = current.getParent();
	}
	return null;
}

function isInConstructorBody(call: CallExpression): boolean {
	let current: Node | undefined = call;
	while (current) {
		if (Node.isConstructorDeclaration(current)) return true;
		if (FUNCTION_LIKE_KINDS.includes(current.getKind())) return false;
		current = current.getParent();
	}
	return false;
}

/** True when the node itself is a function-like declaration. */
export function isFunctionLike(node: Node): boolean {
	return FUNCTION_LIKE_KINDS.includes(node.getKind());
}

/** True when any ancestor of the node is a function-like declaration. */
export function isInsideFunctionLike(node: Node): boolean {
	let current: Node | undefined = node;
	while (current) {
		if (FUNCTION_LIKE_KINDS.includes(current.getKind())) return true;
		current = current.getParent();
	}
	return false;
}

/** Nearest enclosing function-like node, or undefined at module level. */
export function nearestFunctionLike(node: Node | undefined): Node | undefined {
	let current = node;
	while (current) {
		if (FUNCTION_LIKE_KINDS.includes(current.getKind())) return current;
		current = current.getParent();
	}
	return undefined;
}

function unwrapParens(expression: Expression): Expression {
	let expr = expression;
	while (Node.isParenthesizedExpression(expr)) {
		expr = expr.getExpression();
	}
	return expr;
}
