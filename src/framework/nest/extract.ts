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
	NestDtoEntry,
	NestHandlerEntry,
	NestHttpVerb,
	NestModuleEntry,
	NestProviderEntry,
	NestUnresolvedRef,
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

const DTO_DECORATORS = new Set([
	"InputType",
	"ArgsType",
	"ObjectType",
	"PartialType",
	"PickType",
	"OmitType",
	"IntersectionType",
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
	const providers: NestProviderEntry[] = [];
	const dtos: NestDtoEntry[] = [];
	const unresolved: NestUnresolvedRef[] = [];

	for (const file of files) {
		// Suffix DTOs are gate-exempt (a plain *.dto.ts usually has no @nestjs
		// import); decorator-derived entries below all require the gate.
		const gated = referencesNest(file);
		file.forEachDescendant((node) => {
			const cls = node.asKind(SyntaxKind.ClassDeclaration);
			if (!cls) return undefined;
			const className = cls.getName();
			if (!className) return undefined; // anonymous classes cannot be referenced by name
			if (gated) {
				const moduleDecorator = findClassDecorator(cls, "Module");
				if (moduleDecorator) {
					modules.push(
						readModule(
							cls,
							className,
							moduleDecorator,
							file,
							adapter,
							unresolved,
						),
					);
				}
				const controllerDecorator = findClassDecorator(cls, "Controller");
				if (controllerDecorator) {
					controllers.push(
						readController(cls, className, controllerDecorator, file, adapter),
					);
				}
				if (findClassDecorator(cls, "Injectable")) {
					providers.push(nodeEntry(cls, className, file, adapter));
				}
			}
			const via = recognizeDto(cls, className);
			if (via) dtos.push({ ...nodeEntry(cls, className, file, adapter), via });
			return undefined;
		});
	}

	modules.sort(compareEntries);
	controllers.sort(compareEntries);
	providers.sort(compareEntries);
	dtos.sort(compareEntries);
	unresolved.sort(compareUnresolved);
	return { modules, controllers, providers, dtos, unresolved };
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
	unresolved: NestUnresolvedRef[],
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
	if (!metadata || !Node.isObjectLiteralExpression(metadata)) {
		unresolved.push(
			unresolvedRef(
				metadata ?? decorator,
				file,
				adapter,
				"@Module metadata is not a static object literal",
			),
		);
		return entry;
	}
	for (const prop of metadata.getProperties()) {
		if (!Node.isPropertyAssignment(prop)) {
			if (Node.isSpreadAssignment(prop)) {
				unresolved.push(
					unresolvedRef(
						prop,
						file,
						adapter,
						"spread element in module metadata",
					),
				);
			}
			continue;
		}
		const key = prop.getName();
		if (!isModuleListKey(key)) continue;
		const value = prop.getInitializer();
		if (!value || !Node.isArrayLiteralExpression(value)) {
			unresolved.push(
				unresolvedRef(prop, file, adapter, `"${key}" is not a static array`),
			);
			continue;
		}
		entry[key] = readReferenceArray(value, key, file, adapter, unresolved);
	}
	return entry;
}

function isModuleListKey(key: string): key is ModuleListKey {
	return (MODULE_LIST_KEYS as readonly string[]).includes(key);
}

/** Position-carrying base fields shared by every class-derived entry. */
function nodeEntry(
	cls: ClassDeclaration,
	className: string,
	file: SourceFileView,
	adapter: ParserAdapter,
): { filePath: string; className: string; line: number; column: number } {
	const position = adapter.positionOf(file, cls.getStart());
	return {
		filePath: file.filePath,
		className,
		line: position.line,
		column: position.column,
	};
}

/** Suffix first (`Dto`/`DTO` exact), then the pinned decorator list. */
function recognizeDto(
	cls: ClassDeclaration,
	className: string,
): "suffix" | "decorator" | null {
	if (className.endsWith("Dto") || className.endsWith("DTO")) return "suffix";
	for (const decorator of cls.getDecorators()) {
		const name = decoratorName(decorator);
		if (name && DTO_DECORATORS.has(name)) return "decorator";
	}
	return null;
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
function readReferenceArray(
	array: ArrayLiteralExpression,
	listName: ModuleListKey,
	file: SourceFileView,
	adapter: ParserAdapter,
	unresolved: NestUnresolvedRef[],
): string[] {
	const names: string[] = [];
	for (const element of array.getElements()) {
		if (Node.isIdentifier(element)) {
			names.push(element.getText());
			continue;
		}
		if (Node.isObjectLiteralExpression(element)) {
			const classRef = readableClassReference(element);
			if (classRef !== undefined) {
				names.push(classRef);
			} else {
				unresolved.push(
					unresolvedRef(
						element,
						file,
						adapter,
						`object literal element in ${listName} array without a readable class reference`,
					),
				);
			}
			continue;
		}
		const reason =
			element.getKind() === SyntaxKind.SpreadElement
				? `spread element in ${listName} array`
				: `non-identifier element in ${listName} array`;
		unresolved.push(unresolvedRef(element, file, adapter, reason));
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

function unresolvedRef(
	node: Node,
	file: SourceFileView,
	adapter: ParserAdapter,
	reason: string,
): NestUnresolvedRef {
	const position = adapter.positionOf(file, node.getStart());
	return {
		filePath: file.filePath,
		line: position.line,
		column: position.column,
		reason,
	};
}

function compareUnresolved(a: NestUnresolvedRef, b: NestUnresolvedRef): number {
	if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
	if (a.line !== b.line) return a.line - b.line;
	return a.column - b.column;
}
