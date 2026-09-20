export function patch(req: { body: Record<string, unknown> }): object {
	return { ...req.body };
}
