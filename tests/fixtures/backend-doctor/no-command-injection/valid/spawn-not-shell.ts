import { spawn } from "node:child_process";

export function list(dir: string): void {
	spawn("ls", [dir]);
}
