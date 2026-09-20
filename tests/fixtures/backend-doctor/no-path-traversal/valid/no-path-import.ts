export function render(
	parts: string[],
	req: { params: { sep: string } },
): string {
	return parts.join(req.params.sep);
}
