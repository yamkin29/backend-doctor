import { EventEmitter } from "node:event";

function boom(emitter: EventEmitter): void {
	emitter.emit("error", new Error("x"));
}
const emitter = new EventEmitter();
boom(emitter);
