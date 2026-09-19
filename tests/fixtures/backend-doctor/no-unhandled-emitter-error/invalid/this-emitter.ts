import { EventEmitter } from "node:event";

class Bus {
	private emitter = new EventEmitter();

	fail(): void {
		this.emitter.emit("error", new Error("x"));
	}
}
