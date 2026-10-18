import type { Diagnostic } from "../core/types.js";

export interface AnchoredDiagnostic {
	diagnostic: Diagnostic;
	anchor?: string;
}

/** Compare occurrences within one paired file, never sets of position IDs. */
export function filterIntroduced(
	current: readonly AnchoredDiagnostic[],
	baseline: readonly AnchoredDiagnostic[],
	oldLineForNew: (line: number) => number | undefined = () => undefined,
): Diagnostic[] {
	const available = new Map<string, Set<number>>();
	const key = (item: AnchoredDiagnostic): string | undefined =>
		item.anchor && !item.diagnostic.tags.includes("internal")
			? JSON.stringify([
					item.diagnostic.rule,
					item.diagnostic.message,
					item.anchor,
				])
			: undefined;
	for (const [index, item] of baseline.entries()) {
		const fingerprint = key(item);
		if (!fingerprint) continue;
		const bucket = available.get(fingerprint) ?? new Set<number>();
		bucket.add(index);
		available.set(fingerprint, bucket);
	}
	const matched = new Set<number>();
	// First reserve baseline occurrences for unchanged source positions. This
	// prevents a newly inserted identical occurrence from consuming an old one.
	for (const preferPosition of [true, false]) {
		for (const [index, item] of current.entries()) {
			if (matched.has(index)) continue;
			const fingerprint = key(item);
			if (!fingerprint) continue;
			const bucket = available.get(fingerprint);
			if (!bucket) continue;
			const line = preferPosition
				? oldLineForNew(item.diagnostic.line)
				: undefined;
			if (preferPosition && line === undefined) continue;
			for (const candidate of bucket) {
				const prior = baseline[candidate]?.diagnostic;
				if (
					preferPosition &&
					(!prior ||
						prior.line !== line ||
						prior.column !== item.diagnostic.column)
				)
					continue;
				bucket.delete(candidate);
				matched.add(index);
				break;
			}
		}
	}
	return current
		.filter((_, index) => !matched.has(index))
		.map((item) => item.diagnostic);
}
