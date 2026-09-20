/**
 * Nest application model (spec 008): the decorator-derived structure the
 * Nest rule packs (F009–F012) query. Plain data only — positions are
 * adapter-resolved at extraction time so consumers never touch AST nodes.
 * Deterministic by construction: entry arrays are sorted by `extract.ts`;
 * reference and handler lists keep source order.
 */

export type NestHttpVerb =
	| "get"
	| "post"
	| "put"
	| "patch"
	| "delete"
	| "options"
	| "head"
	| "all";

/** Common fields; positions are 1-based, resolved at the class start. */
export interface NestModelNode {
	/** Absolute path of the defining file (same convention as Diagnostic.filePath). */
	filePath: string;
	className: string;
	line: number;
	column: number;
}

export interface NestModuleEntry extends NestModelNode {
	/** Referenced class names, in source order, as written. */
	imports: string[];
	providers: string[];
	controllers: string[];
	exports: string[];
	/** True when any metadata list of this module produced an unresolved entry. */
	hasUnresolved: boolean;
	/** The class carries a @Global decorator. */
	global: boolean;
}

export interface NestHandlerEntry {
	name: string;
	verb: NestHttpVerb;
	/** First string-literal argument of the verb decorator; null when absent. */
	path: string | null;
	line: number;
	column: number;
}

export interface NestControllerEntry extends NestModelNode {
	/** First string-literal argument of @Controller; null when absent. */
	route: string | null;
	handlers: NestHandlerEntry[];
	/** Constructor DI edges in source order (@Optional params excluded). */
	injections: NestInjectionRef[];
}

/** One constructor DI edge of a provider or controller class. */
export interface NestInjectionRef {
	/** Parameter type name as written (identifier only; other types skipped). */
	name: string;
	/** True when the parameter carries @Inject(forwardRef(() => X)). */
	forwardRef: boolean;
	/** 1-based position of the parameter, adapter-resolved at extraction. */
	line: number;
	column: number;
}

export interface NestProviderEntry extends NestModelNode {
	/**
	 * Decorator scope; null when absent or not statically readable. The safe
	 * default for consumers of this field (request-scoped rules treat null as
	 * non-request).
	 */
	scope: "request" | "transient" | "singleton" | null;
	/** Constructor DI edges in source order (@Optional params excluded). */
	injections: NestInjectionRef[];
}

export interface NestDtoEntry extends NestModelNode {
	/** How the class was recognized: name suffix or pinned decorator. */
	via: "suffix" | "decorator";
}

export interface NestUnresolvedRef {
	filePath: string;
	line: number;
	column: number;
	/** Stable human-readable reason, e.g. "spread element in providers array". */
	reason: string;
}

export interface NestAppModel {
	modules: NestModuleEntry[];
	controllers: NestControllerEntry[];
	providers: NestProviderEntry[];
	dtos: NestDtoEntry[];
	unresolved: NestUnresolvedRef[];
}
