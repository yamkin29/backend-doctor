// ESM twin of blocking.cjs (spec 019 AC-4): named imports from node core
// must see the probe's instrumentation too.
import { readFileSync } from "node:fs";
import { pbkdf2Sync } from "node:crypto";

const target = process.env.BLOCK_TARGET;
if (target !== undefined) {
	readFileSync(target);
}
const hash = pbkdf2Sync("backend-doctor", "blocking", 200000, 32, "sha256");
console.log("blocking-done", hash.length);
