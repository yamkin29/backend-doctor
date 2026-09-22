import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import * as crypto from "node:crypto";

const API_KEY = "sk-live-9f8e7d6c5b4a3f2e1d0c7b8a9f0e1d2c";

@Injectable()
export class LegacyCryptoService {
	hashPassword(password: string): string {
		return crypto.createHash("md5").update(password).digest("hex");
	}

	deriveKey(password: string, salt: string): Buffer {
		return crypto.pbkdf2Sync(password, salt, 1000, 32, "sha256");
	}

	sign(payload: string): string {
		return crypto.createHash("sha256").update(payload + API_KEY).digest("hex");
	}

	broadcastFailure(): void {
		const bus = new EventEmitter();
		bus.emit("error", new Error("bus failed"));
	}
}
