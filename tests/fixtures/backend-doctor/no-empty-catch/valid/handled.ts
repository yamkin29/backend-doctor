export function prune(cache: Map<string, string>, key: string): void {
	try {
		cache.delete(key);
	} catch (error) {
		throw new Error(`cache prune failed for ${key}`, { cause: error });
	}
}
