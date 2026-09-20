import { createHash } from "node:crypto";

export function legacy(input: string): string {
	return createHash("MD5").update(input).digest("hex");
}
