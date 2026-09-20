import path from "node:path";

const base = "/uploads";

export function serve(name: string): string {
	return path.join(base, name);
}
