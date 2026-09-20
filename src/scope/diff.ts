import type { LineRange } from "./types.js";

const HUNK_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Extracts the new-side line ranges of every hunk in a unified diff (spec
 * 015). Only the `@@` headers are read — never file headers — so paths with
 * spaces, `diff.noprefix` and `core.quotePath` cannot skew the result. A
 * count-less new side (`@@ -5 +5 @@`) is one line; a zero count
 * (`@@ -3,2 +2,0 @@`, pure deletion) contributes no range.
 */
export function parseHunks(diffText: string): LineRange[] {
	const ranges: LineRange[] = [];
	for (const line of diffText.split("\n")) {
		const match = HUNK_PATTERN.exec(line);
		if (!match) continue;
		const start = Number(match[1]);
		const count = match[2] === undefined ? 1 : Number(match[2]);
		if (count > 0) ranges.push({ start, end: start + count - 1 });
	}
	return ranges;
}
