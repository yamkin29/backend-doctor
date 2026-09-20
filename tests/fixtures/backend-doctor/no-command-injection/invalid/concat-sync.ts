import cp from "node:child_process";

export function list(dir: string): string {
	return cp.execSync("ls " + dir).toString();
}
