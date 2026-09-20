import {
	type CallExpression,
	type Expression,
	Node,
	type SourceFileView,
	SyntaxKind,
} from "../../engine/parser/types.js";
import { isInsideFunctionLike } from "../async/async-calls.js";

/**
 * Shared collector for module-API rules (spec 006 design §1, generalized for
 * spec 007): finds calls whose callee is a property access or bare identifier
 * naming one of the given methods. When `specifiers` is given, the file must
 * reference one of them (precision gate, spec 006 open question 3); when it
 * is absent there is no gate — for global APIs (`fetch`, `Object.assign`) and
 * import-less shapes like hardcoded secrets. `insideFunctionBodies` (default
 * `true`) keeps the F006 "request path" scope; security rules pass `false`
 * because an exploit path does not become safe at module top level.
 */

export interface ModuleApiCallOptions {
	/** Module specifiers (exact match) that activate the scan for a file. Absent = no gate. */
	readonly specifiers?: readonly string[];
	/** Callee method names considered. */
	readonly names: readonly string[];
	/** Optional extra predicate; a candidate is kept only when it holds. */
	readonly accept?: (call: CallExpression, name: string) => boolean;
	/** Restrict matches to call sites inside function bodies. Default `true`. */
	readonly insideFunctionBodies?: boolean;
}

export interface ModuleApiCall {
	/** The candidate call; the report position source. */
	readonly call: CallExpression;
	/** Matched callee method name. */
	readonly name: string;
}

export function findModuleApiCalls(
	file: SourceFileView,
	opts: ModuleApiCallOptions,
): ModuleApiCall[] {
	if (opts.specifiers && opts.specifiers.length > 0) {
		const specifiers = file.getModuleSpecifiers();
		if (!opts.specifiers.some((candidate) => specifiers.includes(candidate))) {
			return [];
		}
	}
	const insideFunctionBodies = opts.insideFunctionBodies ?? true;
	const shadowed = collectSameFileBindings(file);
	const calls: ModuleApiCall[] = [];
	file.forEachDescendant((node) => {
		const call = node.asKind(SyntaxKind.CallExpression);
		if (!call) return undefined;
		if (insideFunctionBodies && !isInsideFunctionLike(call)) return undefined;
		const callee = unwrapParens(call.getExpression());
		if (Node.isPropertyAccessExpression(callee)) {
			const name = callee.getName();
			if (!opts.names.includes(name)) return undefined;
			if (isOwnClassMember(call, callee)) return undefined;
			keep(calls, call, name, opts);
			return undefined;
		}
		if (Node.isIdentifier(callee)) {
			const name = callee.getText();
			if (!opts.names.includes(name)) return undefined;
			if (shadowed.has(name)) return undefined;
			keep(calls, call, name, opts);
			return undefined;
		}
		return undefined;
	});
	return calls;
}

function keep(
	calls: ModuleApiCall[],
	call: CallExpression,
	name: string,
	opts: ModuleApiCallOptions,
): void {
	if (!opts.accept || opts.accept(call, name)) {
		calls.push({ call, name });
	}
}

/**
 * Names bound by any same-file function declaration or variable statement:
 * a bare-identifier callee with one of these names is the user's own
 * function, not the module API.
 */
function collectSameFileBindings(file: SourceFileView): Set<string> {
	const names = new Set<string>();
	file.forEachDescendant((node) => {
		if (Node.isFunctionDeclaration(node)) {
			const name = node.getName();
			if (name && node.getBody()) names.add(name);
			return undefined;
		}
		if (Node.isVariableStatement(node)) {
			for (const declaration of node.getDeclarationList().getDeclarations()) {
				const nameNode = declaration.getNameNode();
				if (Node.isIdentifier(nameNode)) names.add(nameNode.getText());
			}
			return undefined;
		}
		return undefined;
	});
	return names;
}

/**
 * True for `this.<member>` where the nearest enclosing class declares
 * `<member>` — a class method named like a module API is user code, not the
 * module.
 */
function isOwnClassMember(call: CallExpression, callee: Expression): boolean {
	if (!Node.isPropertyAccessExpression(callee)) return false;
	if (callee.getExpression().getText() !== "this") return false;
	const memberName = callee.getName();
	let current: Node | undefined = call;
	while (current) {
		if (Node.isClassDeclaration(current) || Node.isClassExpression(current)) {
			return (
				current
					.getMethods()
					.some((method) => method.getName() === memberName) ||
				current
					.getProperties()
					.some((property) => property.getName() === memberName)
			);
		}
		current = current.getParent();
	}
	return false;
}

function unwrapParens(expression: Expression): Expression {
	let expr = expression;
	while (Node.isParenthesizedExpression(expr)) {
		expr = expr.getExpression();
	}
	return expr;
}
