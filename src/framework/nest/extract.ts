import type { SkippedCheck } from "../../core/types.js";
import {
	type ArrayLiteralExpression,
	type ClassDeclaration,
	type Decorator,
	type MethodDeclaration,
	Node,
	type ObjectLiteralExpression,
	type ParameterDeclaration,
	type ParserAdapter,
	type SourceFileView,
	SyntaxKind,
} from "../../engine/parser/types.js";
import type {
	NestAppModel,
	NestControllerEntry,
	NestDtoEntry,
	NestDtoPropertyRef,
	NestHandlerEntry,
	NestHttpVerb,
	NestInjectionRef,
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

/** `Scope.REQUEST`-style trailing names → model scope values. */
const SCOPE_ENUM_NAMES = {
	REQUEST: "request",
	DEFAULT: "singleton",
	TRANSIENT: "transient",
} as const;

/** String-literal scope values → model scope values. */
const SCOPE_LITERALS = {
	request: "request",
	singleton: "singleton",
	transient: "transient",
} as const;

/** A bare identifier: the only parameter type shape that reads as a class. */
const IDENTIFIER_TYPE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Nest lifecycle hooks never count as a provider's public API (spec 010). */
const LIFECYCLE_HOOKS = new Set([
	"onModuleInit",
	"onModuleDestroy",
	"onApplicationBootstrap",
	"beforeApplicationShutdown",
	"onApplicationShutdown",
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
				const injectableDecorator = findClassDecorator(cls, "Injectable");
				if (injectableDecorator) {
					providers.push({
						...nodeEntry(cls, className, file, adapter),
						scope: readScope(injectableDecorator),
						injections: readInjections(cls, file, adapter),
						publicMethods: readPublicMethods(cls),
					});
				}
			}
			const via = recognizeDto(cls, className);
			if (via) {
				dtos.push({
					...nodeEntry(cls, className, file, adapter),
					via,
					properties: readDtoProperties(cls, file, adapter),
				});
			}
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
		hasUnresolved: false,
		global: findClassDecorator(cls, "Global") !== undefined,
	};
	const call = decorator.getCallExpression();
	const metadata = call?.getArguments()[0];
	if (!metadata || !Node.isObjectLiteralExpression(metadata)) {
		entry.hasUnresolved = true;
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
				entry.hasUnresolved = true;
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
			entry.hasUnresolved = true;
			unresolved.push(
				unresolvedRef(prop, file, adapter, `"${key}" is not a static array`),
			);
			continue;
		}
		entry[key] = readReferenceArray(
			value,
			entry,
			key,
			file,
			adapter,
			unresolved,
		);
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
		injections: readInjections(cls, file, adapter),
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
	module: NestModuleEntry,
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
				module.hasUnresolved = true;
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
		module.hasUnresolved = true;
		unresolved.push(unresolvedRef(element, file, adapter, reason));
	}
	return names;
}

/** `useClass` / `useExisting` / `module` identifier values are the readable references. */
function readableClassReference(
	element: ObjectLiteralExpression,
): string | undefined {
	for (const prop of element.getProperties()) {
		if (!Node.isPropertyAssignment(prop)) continue;
		const name = prop.getName();
		if (name !== "useClass" && name !== "useExisting" && name !== "module") {
			continue;
		}
		const value = prop.getInitializer();
		if (value && Node.isIdentifier(value)) return value.getText();
	}
	return undefined;
}

/** Provider scope from the `@Injectable({ scope: … })` argument; null when unreadable. */
function readScope(decorator: Decorator): NestProviderEntry["scope"] {
	const argument = decorator.getCallExpression()?.getArguments()[0];
	if (!argument || !Node.isObjectLiteralExpression(argument)) return null;
	for (const prop of argument.getProperties()) {
		if (!Node.isPropertyAssignment(prop) || prop.getName() !== "scope") {
			continue;
		}
		const value = prop.getInitializer();
		if (Node.isStringLiteral(value)) {
			const literal = value.getLiteralText() as keyof typeof SCOPE_LITERALS;
			return SCOPE_LITERALS[literal] ?? null;
		}
		if (Node.isPropertyAccessExpression(value)) {
			const enumName = value.getName();
			return (
				SCOPE_ENUM_NAMES[enumName as keyof typeof SCOPE_ENUM_NAMES] ?? null
			);
		}
		return null;
	}
	return null;
}

/** Constructor DI edges: identifier-typed, non-`@Optional` params, source order. */
function readInjections(
	cls: ClassDeclaration,
	file: SourceFileView,
	adapter: ParserAdapter,
): NestInjectionRef[] {
	const ctor = cls.getConstructors()[0];
	if (!ctor) return [];
	const injections: NestInjectionRef[] = [];
	for (const parameter of ctor.getParameters()) {
		if (hasParameterDecorator(parameter, "Optional")) continue;
		const typeNode = parameter.getTypeNode();
		if (!typeNode) continue;
		const name = typeNode.getText();
		if (!IDENTIFIER_TYPE.test(name)) continue;
		const position = adapter.positionOf(file, parameter.getStart());
		injections.push({
			name,
			forwardRef: isForwardRefInjection(parameter),
			decoratorNames: parameterDecorators(parameter),
			line: position.line,
			column: position.column,
		});
	}
	return injections;
}

function parameterDecorators(parameter: ParameterDeclaration): string[] {
	return parameter
		.getDecorators()
		.map((decorator) => decoratorName(decorator))
		.filter((name): name is string => name !== undefined);
}

/** Public instance method names: not static, not lifecycle, not scoped away. */
function readPublicMethods(cls: ClassDeclaration): string[] {
	const names: string[] = [];
	for (const method of cls.getMethods()) {
		if (method.isStatic()) continue;
		if (method.getScope() !== "public") continue;
		if (LIFECYCLE_HOOKS.has(method.getName())) continue;
		names.push(method.getName());
	}
	return names;
}

/** Instance `PropertyDeclaration`s: name, collapsed type text, decorators, position. */
function readDtoProperties(
	cls: ClassDeclaration,
	file: SourceFileView,
	adapter: ParserAdapter,
): NestDtoPropertyRef[] {
	const properties: NestDtoPropertyRef[] = [];
	for (const property of cls.getProperties()) {
		if (property.isStatic()) continue;
		const typeNode = property.getTypeNode();
		const position = adapter.positionOf(file, property.getStart());
		properties.push({
			name: property.getName(),
			typeText: typeNode ? typeNode.getText().replace(/\s+/g, "") : null,
			decoratorNames: property
				.getDecorators()
				.map((decorator) => decoratorName(decorator))
				.filter((name): name is string => name !== undefined),
			hasInitializer: property.getInitializer() !== undefined,
			line: position.line,
			column: position.column,
		});
	}
	return properties;
}

function hasParameterDecorator(
	parameter: ParameterDeclaration,
	name: string,
): boolean {
	return parameter
		.getDecorators()
		.some((decorator) => decoratorName(decorator) === name);
}

/** True when a parameter decorator is `@Inject(forwardRef(() => X))`. */
function isForwardRefInjection(parameter: ParameterDeclaration): boolean {
	for (const decorator of parameter.getDecorators()) {
		if (decoratorName(decorator) !== "Inject") continue;
		const argument = decorator.getCallExpression()?.getArguments()[0];
		if (!argument || !Node.isCallExpression(argument)) continue;
		const target = argument.getExpression();
		const name = Node.isIdentifier(target)
			? target.getText()
			: Node.isPropertyAccessExpression(target)
				? target.getName()
				: undefined;
		if (name === "forwardRef") return true;
	}
	return false;
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

export interface NestModelBuildResult {
	/** The extracted model; absent when extraction failed. */
	model?: NestAppModel;
	/** Constitution §8 record for a crashed extraction. */
	failure?: SkippedCheck;
}

/**
 * Crash isolation for the scan pipeline: a program-level extraction bug
 * becomes a skippedChecks entry instead of a failed scan. Per-decorator
 * problems never reach this path — they land in `unresolved` during
 * extraction.
 */
export function buildNestModelOrSkip(
	files: readonly SourceFileView[],
	adapter: ParserAdapter,
): NestModelBuildResult {
	try {
		return { model: extractNestAppModel(files, adapter) };
	} catch (error) {
		return {
			failure: {
				check: "nest-app-model",
				reason: `extraction failed — ${(error as Error).message}`,
			},
		};
	}
}
