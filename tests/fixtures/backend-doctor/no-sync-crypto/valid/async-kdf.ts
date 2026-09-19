import { pbkdf2 } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);

export async function derive(password: string, salt: string): Promise<Buffer> {
	return pbkdf2Async(password, salt, 100_000, 32, "sha256");
}
