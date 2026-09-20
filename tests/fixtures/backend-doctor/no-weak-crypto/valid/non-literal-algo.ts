import { createHash } from "node:crypto";

export function hash(algorithm: string, input: string): string {
	return createHash(algorithm).update(input).digest("hex");
}
