/**
 * NODE_OPTIONS merging for probe injection (spec 018, design decision 2): the
 * `--require` directive is appended, never clobbered, so user-set values keep
 * working and descendant processes inherit the preload.
 */
export function buildNodeOptions(
	existing: string | undefined,
	hookPath: string,
): string {
	const directive = `--require ${JSON.stringify(hookPath)}`;
	if (existing === undefined || existing.trim() === "") {
		return directive;
	}
	return `${existing} ${directive}`;
}
