import fs from "node:fs";
import path from "node:path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import type {
	FileLoadFailure,
	ParserAdapter,
	ProjectLoadResult,
	SourceFilePosition,
	SourceFileView,
} from "./types.js";

/**
 * The only module allowed to import ts-morph at runtime (constitution §4,
 * spec 003 open question 2). Files are loaded from explicit paths — no
 * tsconfig is consulted in F003 (design decision 3).
 */
export class TsMorphParserAdapter implements ParserAdapter {
	readonly name = "ts-morph";

	createProject(filePaths: string[]): ProjectLoadResult {
		const project = new Project({
			skipAddingFilesFromTsConfig: true,
			skipFileDependencyResolution: true,
		});
		const files: SourceFileView[] = [];
		const failures: FileLoadFailure[] = [];

		for (const filePath of filePaths) {
			const sourceFile = this.loadSourceFile(project, filePath, failures);
			if (sourceFile) files.push(new TsMorphSourceFileView(sourceFile));
		}
		return { files, failures };
	}

	positionOf(file: SourceFileView, pos: number): SourceFilePosition {
		const view = file as TsMorphSourceFileView;
		const { line, column } = view.sourceFile.getLineAndColumnAtPos(pos);
		return { line, column };
	}

	private loadSourceFile(
		project: Project,
		filePath: string,
		failures: FileLoadFailure[],
	): SourceFile | null {
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf8");
		} catch (error) {
			failures.push({
				filePath,
				reason: `read failed — ${(error as Error).message}`,
			});
			return null;
		}
		if (content.includes("\u0000")) {
			failures.push({ filePath, reason: "binary file (NUL byte found)" });
			return null;
		}
		return project.createSourceFile(filePath, content, {
			overwrite: true,
		});
	}
}

class TsMorphSourceFileView implements SourceFileView {
	constructor(readonly sourceFile: SourceFile) {}

	get filePath(): string {
		return this.sourceFile.getFilePath();
	}

	getRelativePathTo(target: string): string {
		// Plain path math instead of ts-morph's cwd-based getRelativePathTo,
		// normalized to posix separators for stable ids and ordering.
		return path
			.relative(target, this.sourceFile.getFilePath())
			.split(path.sep)
			.join("/");
	}

	forEachDescendant(cb: (node: Node) => "skip" | undefined): void {
		this.sourceFile.forEachDescendant((node) => cb(node));
	}

	getModuleSpecifiers(): string[] {
		const specifiers: string[] = [];
		this.sourceFile.forEachDescendant((node) => {
			if (Node.isImportDeclaration(node)) {
				specifiers.push(node.getModuleSpecifierValue());
				return;
			}
			if (Node.isCallExpression(node)) {
				const expression = node.getExpression();
				const isRequire =
					Node.isIdentifier(expression) && expression.getText() === "require";
				const isDynamicImport =
					expression.getKind() === SyntaxKind.ImportKeyword;
				if (!isRequire && !isDynamicImport) return;
				const argument = node.getArguments()[0];
				if (argument && Node.isStringLiteral(argument)) {
					specifiers.push(argument.getText().slice(1, -1));
				}
			}
		});
		return specifiers;
	}

	getText(node?: Node): string {
		return node ? node.getText() : this.sourceFile.getFullText();
	}
}
