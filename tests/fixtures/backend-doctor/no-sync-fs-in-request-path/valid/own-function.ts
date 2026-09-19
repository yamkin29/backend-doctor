import { readFile } from "node:fs/promises";

function existsSync(path: string): boolean {
	return path.length > 0;
}

export async function load(path: string): Promise<string> {
	existsSync(path);
	return readFile(path, "utf8");
}
