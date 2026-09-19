import { randomBytes } from "node:crypto";

export function token(
	callback: (error: Error | null, buffer: Buffer) => void,
): void {
	randomBytes(16, callback);
}
