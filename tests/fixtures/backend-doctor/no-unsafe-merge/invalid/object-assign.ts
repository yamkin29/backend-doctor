export function patch(req: { query: Record<string, string> }): object {
	return Object.assign({}, req.query);
}
