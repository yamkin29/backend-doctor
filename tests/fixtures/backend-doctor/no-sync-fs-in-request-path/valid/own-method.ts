import { existsSync } from "node:fs";

export class Store {
	has(path: string): boolean {
		return this.existsSync(path);
	}

	existsSync(path: string): boolean {
		return path.length > 0;
	}
}
