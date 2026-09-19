import { pbkdf2Sync } from "node:crypto";

export const key = pbkdf2Sync("password", "salt", 100_000, 32, "sha256");
