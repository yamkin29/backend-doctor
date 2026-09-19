/**
 * Parser module boundary (constitution §4): these types are the ONLY surface
 * rules may couple to. Only `ts-morph-adapter.ts` imports ts-morph at runtime;
 * this module re-exports, as types, just the AST vocabulary rules need so far
 * — the adapter grows when the first rule needs more (spec 003, design §1).
 */
import type { Node } from "ts-morph";

export type {
	BinaryExpression,
	CallExpression,
	Expression,
	Identifier,
	NewExpression,
	Node,
	PropertyAccessExpression,
} from "ts-morph";
export { SyntaxKind } from "ts-morph";

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
	/** Full source text, or the text of the given node. */
	getText(node?: Node): string;
}

export interface FileLoadFailure {
	/** Absolute path of the file that could not be loaded. */
	filePath: string;
	/** Human-readable reason (read error, binary content, …). */
	reason: string;
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
