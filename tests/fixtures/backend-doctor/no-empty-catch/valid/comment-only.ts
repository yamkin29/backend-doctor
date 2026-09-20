export function prune(cache: Map<string, string>, key: string): void {
	try {
		cache.delete(key);
	} catch {
		// deletion is best-effort; a failed prune is not worth surfacing
	}
}
