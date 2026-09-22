import * as cp from "node:child_process";

export function transformLegacy(raw: string): string {
	const command = `convert ${raw}`;
	cp.exec(command);
	eval(raw);
	const fn = new Function("return 1");
	return String(fn());
}
