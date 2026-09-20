import path from "node:path";

export function asset(req: { query: { name: string } }): string {
	return path.join("/static", `${req.query.name}.png`);
}
