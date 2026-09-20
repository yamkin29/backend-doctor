import crypto from "node:crypto";

export function tag(payload: string): string {
	return crypto.createHash("sha1").update(payload).digest("hex");
}
