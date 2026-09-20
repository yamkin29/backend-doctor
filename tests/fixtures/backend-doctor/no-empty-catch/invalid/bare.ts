export function drop(cache: Map<string, string>, key: string): void {
	try {
		cache.delete(key);
	} catch {}
}
