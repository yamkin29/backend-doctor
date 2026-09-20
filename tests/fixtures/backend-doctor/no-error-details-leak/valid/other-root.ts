declare const sink: { json(body: unknown): void };

export function ship(err: Error): void {
	sink.json({ stack: err.stack });
}
