import { EventEmitter } from "node:event";

const emitter = new EventEmitter();
emitter.on("error", () => {});
emitter.emit("error", new Error("boom"));
