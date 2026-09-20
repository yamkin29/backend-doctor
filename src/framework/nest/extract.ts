import {
	type ArrayLiteralExpression,
	type ClassDeclaration,
	type Decorator,
	type MethodDeclaration,
	Node,
	type ObjectLiteralExpression,
	type ParserAdapter,
	type SourceFileView,
	SyntaxKind,
} from "../../engine/parser/types.js";
import type {
	NestAppModel,
	NestControllerEntry,
	NestHandlerEntry,
	NestHttpVerb,
	NestModuleEntry,
} from "./model.js";

const MODULE_LIST_KEYS = [
	"imports",
	"providers",
	"controllers",
	"exports",
] as const;
type ModuleListKey = (typeof MODULE_LIST_KEYS)[number];

const VERB_DECORATORS = new Set([
	"Get",
	"Post",
	"Put",
	"Patch",
	"Delete",
	"Options",
	"Head",
	"All",
]);

/**
 * Extracts the Nest application model (spec 008). Decorator-derived entries
 * come only from files referencing a `@nestjs/` specifier (same prefix style
 * as FRAMEWORK_MARKERS); user-land decorators never enter the model. Pure and
 * deterministic: entries are sorted by (filePath, className); reference lists
 * keep source order.
 */
export function extractNestAppModel(
	files: readonly SourceFileView[],
	adapter: ParserAdapter,
): NestAppModel {
	const modules: NestModuleEntry[] = [];
	const controllers: NestControllerEntry[] = [];

	for (const file of files) {
		if (!referencesNest(file)) continue;
		file.forEachDescendant((node) => {
			const cls = node.asKind(SyntaxKind.ClassDeclaration);
			if (!cls) return undefined;
			const className = cls.getName();
			if (!className) return undefined; // anonymous classes cannot be referenced by name
			const moduleDecorator = findClassDecorator(cls, "Module");
			if (moduleDecorator) {
				modules.push(
					readModule(cls, className, moduleDecorator, file, adapter),
				);
			}
			const controllerDecorator = findClassDecorator(cls, "Controller");
			if (controllerDecorator) {
				controllers.push(
					readController(cls, className, controllerDecorator, file, adapter),
				);
			}
			return undefined;
		});
	}

	modules.sort(compareEntries);
	controllers.sort(compareEntries);
	return {
		modules,
		controllers,
		providers: [],
		dtos: [],
		unresolved: [],
	};
}

function referencesNest(file: SourceFileView): boolean {
	return file
		.getModuleSpecifiers()
		.some((specifier) => specifier.startsWith("@nestjs/"));
}

/** Trailing identifier of the decorator expression (`@Mod`, `@Ns.Mod`). */
function decoratorName(decorator: Decorator): string | undefined {
	const expression = decorator.getExpression();
	const target = Node.isCallExpression(expression)
		? expression.getExpression()
		: expression;
	if (Node.isIdentifier(target)) return target.getText();
	if (Node.isPropertyAccessExpression(target)) return target.getName();
	return undefined;
}

function findClassDecorator(
	cls: ClassDeclaration,
	name: string,
): Decorator | undefined {
	return cls
		.getDecorators()
		.find((decorator) => decoratorName(decorator) === name);
}

function readModule(
	cls: ClassDeclaration,
	className: string,
	decorator: Decorator,
	file: SourceFileView,
	adapter: ParserAdapter,
): NestModuleEntry {
	const position = adapter.positionOf(file, cls.getStart());
	const entry: NestModuleEntry = {
		filePath: file.filePath,
		className,
		line: position.line,
		column: position.column,
		imports: [],
		providers: [],
		controllers: [],
		exports: [],
	};
	const call = decorator.getCallExpression();
	const metadata = call?.getArguments()[0];
	if (!metadata || !Node.isObjectLiteralExpression(metadata)) return entry;
	for (const prop of metadata.getProperties()) {
		if (!Node.isPropertyAssignment(prop)) continue;
		const key = prop.getName();
		if (!isModuleListKey(key)) continue;
		const value = prop.getInitializer();
		if (!value || !Node.isArrayLiteralExpression(value)) continue;
		entry[key] = readReferenceArray(value);
	}
	return entry;
}

function isModuleListKey(key: string): key is ModuleListKey {
	return (MODULE_LIST_KEYS as readonly string[]).includes(key);
}

function readController(
	cls: ClassDeclaration,
	className: string,
	decorator: Decorator,
	file: SourceFileView,
	adapter: ParserAdapter,
): NestControllerEntry {
	const position = adapter.positionOf(file, cls.getStart());
	const handlers: NestHandlerEntry[] = [];
	for (const method of cls.getMethods()) {
		const verbDecorator = findVerbDecorator(method);
		if (!verbDecorator) continue;
		const verbName = decoratorName(verbDecorator);
		if (!verbName) continue;
		const methodPosition = adapter.positionOf(file, method.getStart());
		handlers.push({
			name: method.getName(),
			verb: verbName.toLowerCase() as NestHttpVerb,
			path: decoratorStringArgument(verbDecorator),
			line: methodPosition.line,
			column: methodPosition.column,
		});
	}
	return {
		filePath: file.filePath,
		className,
		line: position.line,
		column: position.column,
		route: decoratorStringArgument(decorator),
		handlers,
	};
}

/** First recognized verb decorator wins (a multi-verb method is illegal Nest anyway). */
function findVerbDecorator(method: MethodDeclaration): Decorator | undefined {
	return method.getDecorators().find((decorator) => {
		const name = decoratorName(decorator);
		return name !== undefined && VERB_DECORATORS.has(name);
	});
}

/** First string-literal argument of the decorator's call, or null (recall hole). */
function decoratorStringArgument(decorator: Decorator): string | null {
	const argument = decorator.getCallExpression()?.getArguments()[0];
	if (argument && Node.isStringLiteral(argument)) {
		return argument.getLiteralText();
	}
	return null;
}

/** Identifier elements verbatim; object literals via their readable class reference. */
function readReferenceArray(array: ArrayLiteralExpression): string[] {
	const names: string[] = [];
	for (const element of array.getElements()) {
		if (Node.isIdentifier(element)) {
			names.push(element.getText());
			continue;
		}
		if (Node.isObjectLiteralExpression(element)) {
			const classRef = readableClassReference(element);
			if (classRef !== undefined) names.push(classRef);
		}
	}
	return names;
}

/** `useClass` / `useExisting` identifier values are the readable references. */
function readableClassReference(
	element: ObjectLiteralExpression,
): string | undefined {
	for (const prop of element.getProperties()) {
		if (!Node.isPropertyAssignment(prop)) continue;
		const name = prop.getName();
		if (name !== "useClass" && name !== "useExisting") continue;
		const value = prop.getInitializer();
		if (value && Node.isIdentifier(value)) return value.getText();
	}
	return undefined;
}

function compareEntries(
	a: Pick<NestModuleEntry, "filePath" | "className">,
	b: Pick<NestModuleEntry, "filePath" | "className">,
): number {
	if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
	if (a.className !== b.className) return a.className < b.className ? -1 : 1;
	return 0;
}
