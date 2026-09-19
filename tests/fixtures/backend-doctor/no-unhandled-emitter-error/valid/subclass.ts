import { EventEmitter } from "node:event";

class TypedEmitter extends EventEmitter {}

const emitter = new TypedEmitter();
emitter.emit("error", new Error("x"));
