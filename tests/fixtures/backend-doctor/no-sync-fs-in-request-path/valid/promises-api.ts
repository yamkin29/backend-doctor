import { appendFile, readFile } from "node:fs/promises";

export async function log(path: string, line: string): Promise<void> {
	await appendFile(path, line);
	await readFile(path, "utf8");
}
