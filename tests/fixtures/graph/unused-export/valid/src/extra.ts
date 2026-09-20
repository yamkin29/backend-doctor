import { alsoUsed } from "./shapes";

export function consume(): number {
	return alsoUsed() + 1;
}
