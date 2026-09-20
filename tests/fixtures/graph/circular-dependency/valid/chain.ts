import { middle } from "./middle";
import { relative } from "node:path";

export function chain(): string {
	return `${middle()}${relative(".", ".")}`;
}
