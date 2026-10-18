import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runScan, type ScanResult } from "../core/scan.js";
import type { Diagnostic, SkippedCheck } from "../core/types.js";
import { SUPPORTED_EXTENSIONS } from "../engine/collect.js";
import { mapUnchangedLine } from "./diff.js";
import { nulFields, runGit } from "./git.js";
import { filterIntroduced } from "./introduced.js";

const DIFF_OPTIONS = [
	"--no-ext-diff",
	"--no-textconv",
	"--no-color",
	"--diff-algorithm=myers",
	"--no-indent-heuristic",
];
const EXCLUDED_DIRECTORIES = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
]);

interface TreeEntry {
	mode: string;
	oid: string;
	name: string;
}

/** Historical content is data: no checkout, install, hooks, or config execution. */
export async function compareIntroduced(result: ScanResult): Promise<void> {
	const { scope } = result.input;
	if (scope?.mode !== "introduced" || !scope.baselineCommit) return;
	const repo = scope.repositoryRoot;
	if (!repo) throw new Error("Introduced scope is missing its repository root");
	const project = result.projects[0];
	if (!project) return;
	const limitation = (reason: string) => {
		project.skippedChecks.push({
			check: "baseline-comparison",
			reason: `${reason}; affected findings are unverified candidates, not proven introduced`,
		});
	};
	const tree = await runGit(repo, [
		"ls-tree",
		"-rz",
		"--full-tree",
		scope.baselineCommit,
	]);
	if (!tree.ok) {
		limitation("Cannot read baseline tree");
		return;
	}
	const entries = new Map<string, TreeEntry>();
	for (const record of nulFields(tree.stdout)) {
		const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
		if (match?.[1] && match[2] && match[3])
			entries.set(match[3], { mode: match[1], oid: match[2], name: match[3] });
	}
	const names = new Map<string, string>();
	const renameOutput = await runGit(repo, [
		"diff",
		...DIFF_OPTIONS,
		"--name-status",
		"-z",
		"--find-renames=50%",
		"-l1000",
		scope.baselineCommit,
		"--",
	]);
	if (!renameOutput.ok) {
		limitation("Cannot resolve baseline file correspondence");
		return;
	}
	const fields = nulFields(renameOutput.stdout);
	for (let i = 0; i < fields.length; ) {
		const status = fields[i++] ?? "";
		const from = fields[i++];
		if (status.startsWith("R") || status.startsWith("C")) {
			const to = fields[i++];
			if (status.startsWith("R") && from && to) names.set(to, from);
		}
	}
	const currentPaths = project.analyzedFiles.map((file) =>
		path.resolve(result.input.directory, file),
	);
	const renamedSources = new Set(names.values());
	const paired = new Map<string, string>();
	for (const file of currentPaths) {
		const relative = path
			.relative(repo, fs.realpathSync(file))
			.split(path.sep)
			.join("/");
		// A renamed source belongs to its destination. A recreated untracked
		// old path is a new file and must not consume that baseline a second time.
		const old =
			names.get(relative) ??
			(renamedSources.has(relative) ? undefined : relative);
		if (old && entries.has(old)) paired.set(file, old);
	}
	if (paired.size === 0) return;
	let temp: string;
	try {
		temp = fs.mkdtempSync(path.join(os.tmpdir(), "bd-baseline-"));
	} catch {
		limitation("Cannot create local baseline snapshot");
		return;
	}
	const root = path.join(temp, "tree");
	try {
		fs.mkdirSync(root);
		const sourceNames = new Set(paired.values());
		let incomplete = false;
		for (const entry of entries.values()) {
			const segments = entry.name.split("/");
			if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment)))
				continue;
			const metadata =
				entry.name.endsWith(".json") ||
				entry.name.endsWith(".jsonc") ||
				entry.name.endsWith(".prisma");
			if (!sourceNames.has(entry.name) && !metadata) continue;
			if (entry.mode !== "100644" && entry.mode !== "100755") {
				if (sourceNames.has(entry.name) || metadata) {
					limitation(`${entry.name}: baseline symlinks are not followed`);
					incomplete = true;
				}
				continue;
			}
			const destination = path.resolve(root, ...segments);
			if (
				!destination.startsWith(`${root}${path.sep}`) ||
				segments.includes("..")
			) {
				limitation("Unsafe baseline path");
				incomplete = true;
				continue;
			}
			const blob = await runGit(repo, ["cat-file", "blob", entry.oid]);
			if (!blob.ok) {
				limitation(`${entry.name}: cannot read baseline blob`);
				incomplete = true;
				continue;
			}
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.writeFileSync(destination, blob.stdout);
		}
		// Missing metadata can alter framework gates or resolution for every
		// selected file. Retain candidates rather than subtract an unproven base.
		if (incomplete) return;
		const currentTarget = fs.statSync(result.input.directory).isFile()
			? path.dirname(result.input.directory)
			: result.input.directory;
		const baselineTarget = path.join(
			root,
			path.relative(repo, fs.realpathSync(currentTarget)),
		);
		fs.mkdirSync(baselineTarget, { recursive: true });
		const sources = [...sourceNames]
			.filter((name) => SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext)))
			.map((name) => path.join(root, name));
		const baseline = await runScan({
			directory: baselineTarget,
			ignore: [],
			config: result.input.config,
			scope: {
				mode: "introduced",
				files: new Set(sources),
				lineRanges: new Map(),
			},
			sourceFiles: sources,
			captureAnchors: true,
		});
		const failures = baseline.projects
			.flatMap((p) => p.skippedChecks)
			.filter((s) => s.check !== "project-rules");
		if (failures.length > 0) {
			for (const failure of failures) limitation(cleanReason(failure, root));
			return;
		}
		const kept = new Set<Diagnostic>(result.diagnostics);
		for (const [currentPath, oldName] of paired) {
			const oldPath = path.join(root, oldName);
			const prior = baseline.diagnostics.filter((d) => d.filePath === oldPath);
			const current = result.diagnostics.filter(
				(d) => d.filePath === currentPath,
			);
			if (
				current.some(
					(d) => !d.tags.includes("internal") && !result.anchors?.has(d.id),
				) ||
				prior.some(
					(d) => !d.tags.includes("internal") && !baseline.anchors?.has(d.id),
				)
			) {
				limitation(`${oldName}: source anchors unavailable for some findings`);
			}
			const diff = await runGit(
				repo,
				[
					"diff",
					...DIFF_OPTIONS,
					"--no-index",
					"--text",
					"-U0",
					"--",
					oldPath,
					currentPath,
				],
				{ acceptDiffExit: true },
			);
			if (!diff.ok) {
				limitation(`${oldName}: cannot map source positions`);
				continue;
			}
			const introduced = new Set(
				filterIntroduced(
					current.map((diagnostic) => ({
						diagnostic,
						anchor: result.anchors?.get(diagnostic.id),
					})),
					prior.map((diagnostic) => ({
						diagnostic,
						anchor: baseline.anchors?.get(diagnostic.id),
					})),
					(line) => mapUnchangedLine(diff.stdout, line),
				),
			);
			for (const diagnostic of current)
				if (!introduced.has(diagnostic)) kept.delete(diagnostic);
		}
		result.diagnostics = result.diagnostics.filter((d) => kept.has(d));
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		limitation(
			`Baseline snapshot comparison failed${code ? ` (${code})` : ""}`,
		);
	} finally {
		try {
			fs.rmSync(temp, { recursive: true, force: true });
		} catch {
			limitation("Baseline snapshot cleanup failed");
		}
	}
}

function cleanReason(failure: SkippedCheck, root: string): string {
	return `${failure.check}: ${failure.reason.split(root).join("<baseline>").split(path.dirname(root)).join("<baseline>")}`;
}
