import fs from "node:fs";

export function load(path: string): string {
	return fs.readFileSync(path, "utf8");
}
