import { randomBytes } from "node:crypto";

export function token(): string {
	return randomBytes(16).toString("hex");
}
