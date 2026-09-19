import crypto from "node:crypto";

export function derive(password: string, salt: string): Buffer {
	return crypto.pbkdf2Sync(password, salt, 100_000, 32, "sha256");
}
