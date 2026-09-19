import { scryptSync } from "node:crypto";

export function derive(password: string, salt: string): Buffer {
	return scryptSync(password, salt, 64);
}
