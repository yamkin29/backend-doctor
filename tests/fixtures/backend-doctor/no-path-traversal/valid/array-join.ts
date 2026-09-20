import path from "node:path";

export function render(parts: string[]): string {
	return parts.join("/");
}
