/**
 * Parser module boundary (constitution §4): these exports are the ONLY
 * surface rules may couple to. Only `ts-morph-adapter.ts` imports ts-morph
 * at runtime; this module re-exports just the AST vocabulary rules need so
 * far — the adapter grows when the first rule needs more (spec 003, design
 * §1). `Node` is re-exported as a value because ts-morph's type guards
 * (`Node.isIdentifier`, …) live on the class.
 */
import { Node } from "ts-morph";
import type { NestAppModel } from "../../framework/nest/model.js";

export type {
	ArrayLiteralExpression,
	BinaryExpression,
	CallExpression,
	ClassDeclaration,
	Decorator,
	Expression,
	Identifier,
	MethodDeclaration,
	NewExpression,
	ObjectLiteralExpression,
	ParameterDeclaration,
	PropertyAccessExpression,
	PropertyAssignment,
	SpreadElement,
	StringLiteral,
	TaggedTemplateExpression,
} from "ts-morph";
export { SyntaxKind } from "ts-morph";
export { Node };

export interface SourceFilePosition {
	/** 1-based line. */
	line: number;
	/** 1-based column. */
	column: number;
}

/** Parser-agnostic view of one parsed source file. */
export interface SourceFileView {
	/** Absolute path of the file. */
	readonly filePath: string;
	/** Path of this file relative to the given directory. */
	getRelativePathTo(target: string): string;
	/**
	 * Traverses all descendant nodes. Returning "skip" from the callback
	 * skips that node's subtree.
	 */
	forEachDescendant(cb: (node: Node) => "skip" | undefined): void;
	/**
	 * Module specifiers referenced by the file: static imports, dynamic
	 * `import("…")` and `require("…")` calls. Occurrences in comments or
	 * unrelated string literals are not module references and are excluded
	 * (spec 004, code markers).
	 */
	getModuleSpecifiers(): string[];
	/** Full source text, or the text of the given node. */
	getText(node?: Node): string;
}

export interface FileLoadFailure {
	/** Absolute path of the file that could not be loaded. */
	filePath: string;
	/** Human-readable reason (read error, binary content, …). */
	reason: string;
}

/** What a rule hands to the reporter. Positions are resolved by the engine. */
export interface ReportInput {
	/** AST node to derive the 1-based position from (wins over line/column). */
	node?: Node;
	/** 1-based fallback position when no node is given. */
	line?: number;
	/** 1-based fallback position when no node is given. */
	column?: number;
	message: string;
}

/** Given to rule `create` bodies; rules never stamp ids, severity or tags. */
export interface RuleContext {
	file: SourceFileView;
	/**
	 * Nest application model (spec 008), present when the scan target is a
	 * Nest project. Rules query it for cross-file structure; findings are
	 * still reported against `file` only.
	 */
	nest?: NestAppModel;
	report(input: ReportInput): void;
}

export interface ProjectLoadResult {
	files: SourceFileView[];
	failures: FileLoadFailure[];
}

/**
 * Parser boundary: turns collected file paths into traversable source file
 * views. Implementations must not throw for per-file problems — those belong
 * in `failures` so the scan can continue (constitution §8).
 */
export interface ParserAdapter {
	readonly name: string;
	createProject(filePaths: string[]): ProjectLoadResult;
	positionOf(file: SourceFileView, pos: number): SourceFilePosition;
}
