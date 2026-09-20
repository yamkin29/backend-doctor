declare const log: { error(message: string): void };

export function audit(err: Error): void {
	log.error(err.stack ?? "unknown");
}
