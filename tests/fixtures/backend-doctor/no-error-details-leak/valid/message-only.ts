export function errorHandler(
	err: Error,
	res: { status(code: number): { json(body: unknown): void } },
): void {
	res.status(500).json({ message: err.message });
}
