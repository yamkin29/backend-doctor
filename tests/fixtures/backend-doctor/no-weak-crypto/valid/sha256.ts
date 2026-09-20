import { createHash } from "node:crypto";

export function hash(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}
