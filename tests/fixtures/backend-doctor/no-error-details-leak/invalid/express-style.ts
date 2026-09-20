export function errorHandler(
	err: Error,
	req: unknown,
	res: { status(code: number): { json(body: unknown): void } },
	_next: unknown,
): void {
	console.error(err);
	res.status(500).json({ message: "Internal Server Error", stack: err.stack });
}
