import { serveA } from "./a";

export function serveC(): string {
	return `c<-${serveA()}`;
}
