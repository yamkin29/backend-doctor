import { EventEmitter } from "node:event";

const emitter = new EventEmitter();
emitter.emit("close");
