import { exec } from "node:child_process";

function exec(command: string): string {
	return command.trim();
}

export function run(cmd: string): void {
	exec(cmd);
}
