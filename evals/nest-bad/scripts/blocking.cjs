"use strict";
// Deliberate blocking work for the F022 probe check (spec 022 AC-8).
// pbkdf2Sync is one of the probe's wrapped APIs, so every call above the
// block threshold is attributed with its stack; a busy-wait loop would
// only surface in loopLag, not in findings.blocking.calls.
const crypto = require("node:crypto");

for (let i = 0; i < 3; i++) {
	crypto.pbkdf2Sync("backend-doctor", `salt-${i}`, 200000, 64, "sha256");
}

console.log("blocking-done");
