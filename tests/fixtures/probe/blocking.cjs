// Deliberately blocking fixture (spec 019): a big sync read (path via
// BLOCK_TARGET when given) plus slow sync crypto, long past any threshold.
const crypto = require("node:crypto");
const fs = require("node:fs");

const target = process.env.BLOCK_TARGET;
if (target !== undefined) {
	fs.readFileSync(target);
}
const hash = crypto.pbkdf2Sync("backend-doctor", "blocking", 200000, 32, "sha256");
console.log("blocking-done", hash.length);
