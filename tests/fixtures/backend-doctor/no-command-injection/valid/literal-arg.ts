import { exec } from "node:child_process";

export function version(): void {
	exec("node --version");
}
