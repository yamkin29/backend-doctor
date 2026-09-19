const cache = {
	readFileSync(path: string): string {
		return "";
	},
};

export function load(path: string): string {
	return cache.readFileSync(path);
}
