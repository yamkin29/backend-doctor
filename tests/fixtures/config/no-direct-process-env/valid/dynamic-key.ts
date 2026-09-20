export function readKey(key: string): string | undefined {
	return process.env[key];
}
