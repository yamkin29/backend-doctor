// Long-running fixture with periodic deliberate blocking (spec 019): a sync
// crypto burst every 100ms for ~2.5s, then a normal exit.
const crypto = require("node:crypto");

const startedAt = Date.now();
const timer = setInterval(() => {
	crypto.pbkdf2Sync("backend-doctor", "spin", 20000, 32, "sha256");
	if (Date.now() - startedAt > 2500) {
		clearInterval(timer);
		console.log("spin-done");
	}
}, 100);
