export function prune(cache: Map<string, string>, key: string): void {
	try {
		cache.delete(key);
	} catch (error) {
		throw error;
	}
}
