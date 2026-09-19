import fs from "node:fs";

export function boot(path: string): () => string {
	return () => fs.readFileSync(path, "utf8");
}
