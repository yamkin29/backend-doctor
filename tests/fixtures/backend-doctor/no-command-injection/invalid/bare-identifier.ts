import { exec } from "node:child_process";

export function run(cmd: string): void {
	exec(cmd);
}
