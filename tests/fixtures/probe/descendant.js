import { spawnSync } from "node:child_process";

const grandchild = spawnSync(
	process.execPath,
	["-e", 'console.log("grandchild-output")'],
	{ encoding: "utf8" },
);
console.log("descendant-parent-output");
