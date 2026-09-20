import { serveC } from "./c";

export function serveB(): string {
	return `b<-${serveC()}`;
}
